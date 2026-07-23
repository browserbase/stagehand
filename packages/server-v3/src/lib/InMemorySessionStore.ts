import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { V3Options, LogLine, Api } from "@browserbasehq/stagehand";
import { V3 } from "@browserbasehq/stagehand";
import type {
  SessionStore,
  CreateSessionParams,
  RequestContext,
  SessionCacheConfig,
  SessionStartResult,
} from "./SessionStore.js";

const DEFAULT_MAX_CAPACITY = 100;
const DEFAULT_TTL_MS = 0; // 0 = infinite (no TTL-based eviction)

interface RequestLoggerScope {
  logger?: (message: LogLine) => void;
  active: boolean;
}

/**
 * Internal node for LRU linked list
 */
interface LruNode {
  sessionId: string;
  params: CreateSessionParams;
  stagehand: V3 | null;
  initialization: Promise<V3> | null;
  closePromise: Promise<void> | null;
  deleted: boolean;
  expiry: number;
  prev: LruNode | null;
  next: LruNode | null;
}

function hasProviderAuth(model: Api.ModelConfig): boolean {
  return "auth" in model && model.auth !== undefined;
}

export function withModelApiKeyFallback(
  model: Api.ModelConfig,
  modelApiKey?: string,
): Api.ModelConfig {
  if (
    !modelApiKey ||
    hasProviderAuth(model) ||
    ("apiKey" in model && model.apiKey)
  ) {
    return model;
  }

  return { ...model, apiKey: modelApiKey } as Api.ModelConfig;
}

/**
 * In-memory implementation of SessionStore with full caching support.
 *
 * Features:
 * - LRU eviction when at capacity
 * - TTL-based expiration
 * - Lazy V3 instance creation
 * - Request-scoped streaming logs
 * - Automatic cleanup of evicted sessions
 *
 * This is the default implementation used when no custom store is provided.
 * For stateless pod architectures, use a database-backed implementation.
 */
export class InMemorySessionStore implements SessionStore {
  private first: LruNode | null = null;
  private last: LruNode | null = null;
  private items: Map<string, LruNode> = new Map();
  private maxCapacity: number;
  private ttlMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly requestLogger = new AsyncLocalStorage<RequestLoggerScope>();

  constructor(config?: SessionCacheConfig) {
    this.maxCapacity = config?.maxCapacity ?? DEFAULT_MAX_CAPACITY;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
    this.startCleanupInterval();
  }

  /**
   * Serialize mutations to the map and LRU list. Browser shutdown happens
   * after a node is detached so slow cleanup does not block unrelated sessions.
   */
  private async mutate<T>(operation: () => T): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    return await result;
  }

  /**
   * Start periodic cleanup of expired sessions.
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpired().catch(console.error);
    }, 60_000);
    this.cleanupInterval.unref();
  }

  /**
   * Cleanup expired sessions.
   */
  private async cleanupExpired(): Promise<void> {
    const expired = await this.mutate(() => {
      if (this.ttlMs <= 0) return [];

      const now = Date.now();
      const nodes: LruNode[] = [];
      for (const node of this.items.values()) {
        if (node.expiry <= now) {
          this.detachNode(node);
          nodes.push(node);
        }
      }
      return nodes;
    });

    await Promise.all(expired.map((node) => this.closeNode(node)));
  }

  /**
   * Bump a node to the end of the LRU list (most recently used).
   */
  private bumpNode(node: LruNode): void {
    node.expiry = this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity;

    if (this.last === node) return;

    const { prev, next } = node;
    if (prev) prev.next = next;
    if (next) next.prev = prev;
    if (this.first === node) this.first = next;

    node.prev = this.last;
    node.next = null;
    if (this.last) this.last.next = node;
    this.last = node;

    if (!this.first) this.first = node;
  }

  /**
   * Remove a node from cache state synchronously. Cleanup is deliberately
   * separate because closing a browser may be slow.
   */
  private detachNode(node: LruNode): void {
    if (node.deleted) return;

    node.deleted = true;
    if (this.items.get(node.sessionId) === node) {
      this.items.delete(node.sessionId);
    }

    const { prev, next } = node;
    if (prev) prev.next = next;
    if (next) next.prev = prev;
    if (this.first === node) this.first = next;
    if (this.last === node) this.last = prev;
    node.prev = null;
    node.next = null;
  }

  /**
   * Close an initialized or initializing node exactly once.
   */
  private closeNode(node: LruNode): Promise<void> {
    if (node.closePromise) return node.closePromise;

    node.closePromise = (async () => {
      if (node.initialization) {
        try {
          await node.initialization;
        } catch {
          // Initialization already performs best-effort cleanup on failure.
        }
      }

      if (!node.stagehand) return;
      try {
        await node.stagehand.close();
      } catch (error) {
        console.error(
          `Error closing stagehand for session ${node.sessionId}:`,
          error,
        );
      } finally {
        node.stagehand = null;
      }
    })();

    return node.closePromise;
  }

  /**
   * Initialize a node once. Concurrent callers share this promise.
   */
  private initializeNode(node: LruNode, ctx: RequestContext): Promise<V3> {
    const initialization = this.runWithRequestContext(ctx, async () => {
      const stagehand = this.createStagehand(
        this.buildV3Options(node.params, ctx),
      );
      try {
        await stagehand.init();
      } catch (error) {
        try {
          await stagehand.close();
        } catch {
          // best-effort cleanup for failed init attempts
        }
        throw error;
      }

      if (node.deleted) {
        try {
          await stagehand.close();
        } catch {
          // best-effort cleanup for a session deleted during initialization
        }
        throw new Error(`Session not found: ${node.sessionId}`);
      }

      node.stagehand = stagehand;
      return stagehand;
    });

    node.initialization = initialization;
    void initialization.catch(() => {
      if (!node.deleted && node.initialization === initialization) {
        node.initialization = null;
      }
    });
    return initialization;
  }

  protected createStagehand(options: V3Options): V3 {
    return new V3(options);
  }

  async startSession(params: CreateSessionParams): Promise<SessionStartResult> {
    const sessionId = params.browserbaseSessionID ?? randomUUID();
    await this.createSession(sessionId, params);

    return {
      sessionId,
      cdpUrl: params.connectUrl ?? "",
      available: true,
    };
  }

  async endSession(sessionId: string): Promise<void> {
    await this.deleteSession(sessionId);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    const expired = await this.mutate(() => {
      const node = this.items.get(sessionId);
      if (!node) return null;
      if (this.ttlMs > 0 && node.expiry <= Date.now()) {
        this.detachNode(node);
        return node;
      }
      return false;
    });

    if (expired) {
      await this.closeNode(expired);
      return false;
    }
    return expired === false;
  }

  async getOrCreateStagehand(
    sessionId: string,
    ctx: RequestContext,
  ): Promise<V3> {
    const resolution = await this.mutate(() => {
      const node = this.items.get(sessionId);
      if (!node) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      if (this.ttlMs > 0 && node.expiry <= Date.now()) {
        this.detachNode(node);
        return { expired: node } as const;
      }

      this.bumpNode(node);
      if (node.stagehand) {
        return { stagehand: node.stagehand } as const;
      }

      if (!node.initialization) {
        this.initializeNode(node, ctx);
      }
      return { initialization: node.initialization! } as const;
    });

    if ("expired" in resolution) {
      await this.closeNode(resolution.expired);
      throw new Error(`Session expired: ${sessionId}`);
    }
    if ("stagehand" in resolution) return resolution.stagehand;
    return await resolution.initialization;
  }

  async runWithRequestContext<T>(
    ctx: RequestContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const scope: RequestLoggerScope = {
      logger: ctx.logger,
      active: true,
    };

    return await this.requestLogger.run(scope, async () => {
      try {
        return await operation();
      } finally {
        scope.active = false;
      }
    });
  }

  /**
   * Build V3Options from stored params and request context.
   */
  private buildV3Options(
    params: CreateSessionParams,
    ctx: RequestContext,
  ): V3Options {
    const isBrowserbase = params.browserType === "browserbase";

    const options: V3Options = {
      env: isBrowserbase ? "BROWSERBASE" : "LOCAL",
      model: ctx.requestModelConfig
        ? withModelApiKeyFallback(ctx.requestModelConfig, ctx.modelApiKey)
        : {
            modelName: params.modelName,
            apiKey: ctx.modelApiKey,
          },
      verbose: params.verbose,
      systemPrompt: params.systemPrompt,
      selfHeal: params.selfHeal,
      domSettleTimeout: params.domSettleTimeoutMs,
      experimental: params.experimental,
      logger: (message: LogLine) => {
        const scope = this.requestLogger.getStore();
        if (scope?.active) scope.logger?.(message);
      },
    };

    if (isBrowserbase) {
      options.apiKey = params.browserbaseApiKey;
      options.projectId = params.browserbaseProjectId;

      if (params.browserbaseSessionID) {
        options.browserbaseSessionID = params.browserbaseSessionID;
      }

      if (params.browserbaseSessionCreateParams) {
        options.browserbaseSessionCreateParams =
          params.browserbaseSessionCreateParams;
      }
    } else if (params.localBrowserLaunchOptions) {
      options.localBrowserLaunchOptions = params.localBrowserLaunchOptions;
    }

    return options;
  }

  async createSession(
    sessionId: string,
    params: CreateSessionParams,
  ): Promise<void> {
    const evicted = await this.mutate(() => {
      if (this.items.has(sessionId)) {
        throw new Error(`Session already exists: ${sessionId}`);
      }

      const nodes: LruNode[] = [];
      while (this.maxCapacity > 0 && this.items.size >= this.maxCapacity) {
        if (!this.first) break;
        const node = this.first;
        this.detachNode(node);
        nodes.push(node);
      }

      const node: LruNode = {
        sessionId,
        params,
        stagehand: null,
        initialization: null,
        closePromise: null,
        deleted: false,
        expiry: this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity,
        prev: this.last,
        next: null,
      };

      this.items.set(sessionId, node);
      if (this.last) this.last.next = node;
      this.last = node;
      if (!this.first) this.first = node;
      return nodes;
    });

    await Promise.all(evicted.map((node) => this.closeNode(node)));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const node = await this.mutate(() => {
      const current = this.items.get(sessionId);
      if (current) this.detachNode(current);
      return current;
    });

    if (node) await this.closeNode(node);
  }

  async getSessionConfig(sessionId: string): Promise<CreateSessionParams> {
    return await this.mutate(() => {
      const node = this.items.get(sessionId);
      if (!node) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return node.params;
    });
  }

  async updateCacheConfig(config: SessionCacheConfig): Promise<void> {
    if (config.maxCapacity !== undefined && config.maxCapacity <= 0) {
      throw new Error("Max capacity must be greater than 0");
    }

    const evicted = await this.mutate(() => {
      if (config.maxCapacity !== undefined) {
        this.maxCapacity = config.maxCapacity;
      }
      if (config.ttlMs !== undefined) {
        this.ttlMs = config.ttlMs;
      }

      const nodes: LruNode[] = [];
      while (this.maxCapacity > 0 && this.items.size > this.maxCapacity) {
        if (!this.first) break;
        const node = this.first;
        this.detachNode(node);
        nodes.push(node);
      }
      return nodes;
    });

    await Promise.all(evicted.map((node) => this.closeNode(node)));
  }

  getCacheConfig(): SessionCacheConfig {
    return {
      maxCapacity: this.maxCapacity,
      ttlMs: this.ttlMs,
    };
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const nodes = await this.mutate(() => {
      const current = Array.from(this.items.values());
      for (const node of current) this.detachNode(node);
      return current;
    });
    await Promise.all(nodes.map((node) => this.closeNode(node)));
  }

  /**
   * Get the number of cached sessions.
   */
  get size(): number {
    return this.items.size;
  }
}
