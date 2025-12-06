import { Stagehand, type LogLine } from "@browserbasehq/stagehand";
import { FastifyBaseLogger } from "fastify";
import type { Stagehand as V3Stagehand } from "stagehand-v3";

export interface CachedStagehandEntry {
  stagehand: Stagehand | V3Stagehand;
  loggerRef: { current?: (data: LogLine) => void };
}

interface LruNode {
  key: string;
  value: CachedStagehandEntry;
  expiry: number;
  prev: LruNode | null;
  next: LruNode | null;
}

const DEFAULT_MAX_CAPACITY = 100;
const DEFAULT_ITEM_TTL_MS = 30_000; // 30 seconds

export class SessionCache {
  private first: LruNode | null = null;
  private last: LruNode | null = null;
  private items: Map<string, LruNode> = new Map<string, LruNode>();
  private maxCapacity: number;
  private ttlMs: number;
  private readonly onEvictCallback?: (
    sessionIdKey: string,
    entry: CachedStagehandEntry,
  ) => Promise<void> | void;
  private serverLogger: FastifyBaseLogger;

  constructor(
    serverLogger: FastifyBaseLogger,
    onEvictCallback?: (
      sessionIdKey: string,
      entry: CachedStagehandEntry,
    ) => Promise<void> | void,
    maxCapacity: number = DEFAULT_MAX_CAPACITY,
    ttlMs: number = DEFAULT_ITEM_TTL_MS,
  ) {
    if (maxCapacity <= 0) {
      throw new Error("Max capacity must be greater than 0 for LRU cache.");
    }
    this.serverLogger = serverLogger;
    this.maxCapacity = maxCapacity;
    this.ttlMs = ttlMs;
    this.onEvictCallback = onEvictCallback;
  }

  get size(): number {
    return this.items.size;
  }

  /**
   * Updates the cache configuration dynamically.
   * If the new maxCapacity is smaller than the current size, it will evict items.
   * @param config - The new configuration values
   */
  updateConfig(config: { maxCapacity?: number; ttlMs?: number }): void {
    if (config.maxCapacity !== undefined) {
      if (config.maxCapacity <= 0) {
        throw new Error("Max capacity must be greater than 0 for LRU cache.");
      }
      const previousMaxCapacity = this.maxCapacity;
      this.maxCapacity = config.maxCapacity;

      // If the new capacity is smaller, evict excess items
      if (this.maxCapacity < previousMaxCapacity) {
        const diff = previousMaxCapacity - this.maxCapacity;
        if (diff > 0) {
          for (let i = 0; i < diff; i += 1) {
            this._evict();
          }
        }
        // Checking if the downsizing did not evict enough items
        if (this.items.size > this.maxCapacity) {
          throw new Error(
            `Cache downsizing did not evict enough items. ${String(this.items.size)} items remain for max capacity ${String(this.maxCapacity)}.`,
          );
        }
      }

      this.serverLogger.info(
        `Updated cache maxCapacity from ${String(previousMaxCapacity)} to ${String(this.maxCapacity)}`,
      );
    }

    if (config.ttlMs !== undefined) {
      const previousTtlMs = this.ttlMs;
      this.ttlMs = config.ttlMs;
      this.serverLogger.info(
        `Updated cache TTL from ${String(previousTtlMs)}ms to ${String(this.ttlMs)}ms`,
      );
    }
  }

  /**
   * Gets the current cache configuration
   * @returns The current maxCapacity and ttl values
   */
  getConfig(): { maxCapacity: number; ttlMs: number } {
    return {
      maxCapacity: this.maxCapacity,
      ttlMs: this.ttlMs,
    };
  }

  private _bumpNode(node: LruNode): void {
    // Bump the expiry time
    node.expiry = this.ttlMs > 0 ? Date.now() + this.ttlMs : this.ttlMs;
    if (this.last === node) {
      return; // Already the most recent
    }

    const { prev, next } = node;

    // Unlink from current position
    if (prev) {
      prev.next = next;
    }
    if (next) {
      next.prev = prev;
    }

    if (this.first === node) {
      this.first = next;
    }

    // Link to the end (most recent)
    node.prev = this.last;
    node.next = null;

    if (this.last) {
      this.last.next = node;
    }
    this.last = node;

    if (!this.first) {
      // If cache was empty or became empty and this is the new first
      this.first = node;
    }
  }

  private async _triggerEvictionCallback(
    key: string,
    value: CachedStagehandEntry,
  ): Promise<void> {
    if (this.onEvictCallback) {
      try {
        await Promise.resolve(this.onEvictCallback(key, value));
      } catch (err: unknown) {
        this.serverLogger.error(err, "Error during onEvictCallback");
      }
    }
  }

  private _evict(): void {
    const lruNode = this.first;
    if (!lruNode) {
      return;
    }

    this.items.delete(lruNode.key);

    this.first = lruNode.next;
    if (this.first) {
      this.first.prev = null;
    } else {
      // Cache became empty
      this.last = null;
    }
    this._triggerEvictionCallback(lruNode.key, lruNode.value).catch(
      (err: unknown) => {
        this.serverLogger.error(
          err,
          "Unhandled rejection in _triggerEvictionCallback during _evict",
        );
      },
    );
  }

  get(sessionIdKey: string): CachedStagehandEntry | undefined {
    const node = this.items.get(sessionIdKey);
    if (!node) {
      return undefined;
    }

    if (this.ttlMs > 0 && node.expiry <= Date.now()) {
      this.delete(sessionIdKey);
      return undefined;
    }

    this._bumpNode(node);
    return node.value;
  }

  set(sessionIdKey: string, value: CachedStagehandEntry): void {
    let node = this.items.get(sessionIdKey);

    if (node) {
      // Update existing item
      node.value = value;
      node.expiry = this.ttlMs > 0 ? Date.now() + this.ttlMs : this.ttlMs;
      if (node !== this.last) {
        this._bumpNode(node);
      }
      return;
    }

    // Add new item
    if (this.maxCapacity > 0 && this.items.size >= this.maxCapacity) {
      this._evict();
    }

    node = {
      key: sessionIdKey,
      value,
      expiry: this.ttlMs > 0 ? Date.now() + this.ttlMs : this.ttlMs,
      prev: this.last,
      next: null,
    };
    this.items.set(sessionIdKey, node);

    if (this.last) {
      this.last.next = node;
    }
    this.last = node;

    if (!this.first) {
      this.first = node;
    }
  }

  delete(sessionIdKey: string): boolean {
    const node = this.items.get(sessionIdKey);
    if (!node) {
      return false;
    }
    this.items.delete(sessionIdKey);

    const { prev, next } = node;
    if (prev) {
      prev.next = next;
    }
    if (next) {
      next.prev = prev;
    }

    if (this.first === node) {
      this.first = next;
    }
    if (this.last === node) {
      this.last = prev;
    }

    if (this.items.size === 0) {
      this.first = null;
      this.last = null;
    }

    this._triggerEvictionCallback(node.key, node.value).catch(
      (err: unknown) => {
        this.serverLogger.error(
          err,
          `Unhandled rejection from _triggerEvictionCallback during delete for ${node.key}`,
        );
      },
    );

    return true;
  }

  clear(): void {
    const itemsToEvict: [string, CachedStagehandEntry][] = [];
    for (const node of this.items.values()) {
      itemsToEvict.push([node.key, node.value]);
    }

    this.items.clear();
    this.first = null;
    this.last = null;

    for (const [key, value] of itemsToEvict) {
      this._triggerEvictionCallback(key, value).catch((err: unknown) => {
        this.serverLogger.error(
          err,
          `Unhandled rejection from _triggerEvictionCallback during clear for ${key}`,
        );
      });
    }
  }
}
