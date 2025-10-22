import { createHash } from "crypto";
import type { ActHandler } from "../handlers/actHandler";
import type { LLMClient } from "../llm/LLMClient";
import type { ActResult, Logger } from "../types/public";
import type { Page } from "../understudy/page";
import { CacheStorage } from "./CacheStorage";
import { safeGetPageUrl } from "./utils";
import {
  ActCacheContext,
  ActCacheDeps,
  CachedActEntry,
} from "../types/private";

export class ActCache {
  private readonly storage: CacheStorage;
  private readonly logger: Logger;
  private readonly getActHandler: () => ActHandler | null;
  private readonly getDefaultLlmClient: () => LLMClient;
  private readonly domSettleTimeoutMs?: number;

  constructor({
    storage,
    logger,
    getActHandler,
    getDefaultLlmClient,
    domSettleTimeoutMs,
  }: ActCacheDeps) {
    this.storage = storage;
    this.logger = logger;
    this.getActHandler = getActHandler;
    this.getDefaultLlmClient = getDefaultLlmClient;
    this.domSettleTimeoutMs = domSettleTimeoutMs;
  }

  get enabled(): boolean {
    return this.storage.enabled;
  }

  async prepareContext(
    instruction: string,
    page: Page,
    variables?: Record<string, string>,
  ): Promise<ActCacheContext | null> {
    if (!this.enabled) return null;
    const sanitizedInstruction = instruction.trim();
    const sanitizedVariables = variables ? { ...variables } : {};
    const pageUrl = await safeGetPageUrl(page);
    const cacheKey = this.buildActCacheKey(
      sanitizedInstruction,
      pageUrl,
      sanitizedVariables,
    );
    return {
      instruction: sanitizedInstruction,
      cacheKey,
      pageUrl,
      variables: sanitizedVariables,
    };
  }

  async tryReplay(
    context: ActCacheContext,
    page: Page,
    timeout?: number,
  ): Promise<ActResult | null> {
    if (!this.enabled) return null;

    const {
      value: entry,
      error,
      path,
    } = await this.storage.readJson<CachedActEntry>(`${context.cacheKey}.json`);
    if (error && path) {
      this.logger({
        category: "cache",
        message: `failed to read act cache entry: ${path}`,
        level: 2,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return null;
    }
    if (!entry) return null;
    if (entry.version !== 1) return null;
    if (!Array.isArray(entry.actions) || entry.actions.length === 0) {
      return null;
    }

    this.logger({
      category: "cache",
      message: "act cache hit",
      level: 1,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        url: {
          value: entry.url ?? context.pageUrl,
          type: "string",
        },
      },
    });

    return await this.replayCachedActions(entry, page, timeout);
  }

  async store(context: ActCacheContext, result: ActResult): Promise<void> {
    if (!this.enabled) return;

    const entry: CachedActEntry = {
      version: 1,
      instruction: context.instruction,
      url: context.pageUrl,
      variables: context.variables,
      actions: result.actions ?? [],
      actionDescription: result.actionDescription,
      message: result.message,
    };

    const { error, path } = await this.storage.writeJson(
      `${context.cacheKey}.json`,
      entry,
    );
    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to write act cache entry",
        level: 1,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return;
    }

    this.logger({
      category: "cache",
      message: "act cache stored",
      level: 2,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        url: { value: context.pageUrl, type: "string" },
      },
    });
  }

  private buildActCacheKey(
    instruction: string,
    url: string,
    variables: Record<string, string>,
  ): string {
    const payload = JSON.stringify({
      instruction,
      url,
      variables,
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  private async replayCachedActions(
    entry: CachedActEntry,
    page: Page,
    timeout?: number,
  ): Promise<ActResult> {
    const handler = this.getActHandler();
    if (!handler) {
      throw new Error("V3 not initialized. Call init() before act().");
    }

    const execute = async (): Promise<ActResult> => {
      const actionResults: ActResult[] = [];
      for (const action of entry.actions) {
        const result = await handler.actFromObserveResult(
          action,
          page,
          this.domSettleTimeoutMs,
          this.getDefaultLlmClient(),
        );
        actionResults.push(result);
        if (!result.success) {
          break;
        }
      }

      if (actionResults.length === 0) {
        return {
          success: false,
          message: "Failed to perform act: cached entry has no actions",
          actionDescription: entry.actionDescription ?? entry.instruction,
          actions: [],
        };
      }

      const success = actionResults.every((r) => r.success);
      const actions = actionResults.flatMap((r) => r.actions ?? []);
      const message =
        actionResults
          .map((r) => r.message)
          .filter((m) => m && m.trim().length > 0)
          .join(" → ") ||
        entry.message ||
        `Replayed ${entry.actions.length} cached action${
          entry.actions.length === 1 ? "" : "s"
        }.`;
      const actionDescription =
        entry.actionDescription ||
        actionResults[actionResults.length - 1]?.actionDescription ||
        entry.actions[entry.actions.length - 1]?.description ||
        entry.instruction;
      return {
        success,
        message,
        actionDescription,
        actions,
      };
    };

    return await this.runWithTimeout(execute, timeout);
  }

  private async runWithTimeout<T>(
    run: () => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    if (!timeout) {
      return await run();
    }

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`act() timed out after ${timeout}ms`));
      }, timeout);

      void run().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}
