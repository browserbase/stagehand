import { createHash } from "crypto";
import type { ActHandler } from "../handlers/actHandler.js";
import type { LLMClient } from "../llm/LLMClient.js";
import type { Action, ActResult, Logger } from "../types/public/index.js";
import type { Page } from "../understudy/page.js";
import { CacheStorage } from "./CacheStorage.js";
import { safeGetPageUrl, waitForCachedSelector } from "./utils.js";
import {
  ActCacheContext,
  ActCacheDeps,
  CachedActEntry,
} from "../types/private/index.js";
import { StagehandNotInitializedError } from "../types/public/sdkErrors.js";

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
    const sanitizedVariables = variables ? { ...variables } : undefined;
    const variableKeys = sanitizedVariables
      ? Object.keys(sanitizedVariables).sort()
      : [];
    const pageUrl = await safeGetPageUrl(page);
    const cacheKey = this.buildActCacheKey(
      sanitizedInstruction,
      pageUrl,
      variableKeys,
    );
    return {
      instruction: sanitizedInstruction,
      cacheKey,
      pageUrl,
      variableKeys,
      variables: sanitizedVariables,
    };
  }

  async tryReplay(
    context: ActCacheContext,
    page: Page,
    timeout?: number,
    llmClientOverride?: LLMClient,
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

    const entryVariableKeys = Array.isArray(entry.variableKeys)
      ? [...entry.variableKeys].sort()
      : [];
    const contextVariableKeys = [...context.variableKeys];

    if (!this.doVariableKeysMatch(entryVariableKeys, contextVariableKeys)) {
      return null;
    }

    if (
      contextVariableKeys.length > 0 &&
      (!context.variables ||
        !this.hasAllVariableValues(contextVariableKeys, context.variables))
    ) {
      this.logger({
        category: "cache",
        message: "act cache miss: missing variables for replay",
        level: 2,
        auxiliary: {
          instruction: { value: context.instruction, type: "string" },
        },
      });
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

    return await this.replayCachedActions(
      context,
      entry,
      page,
      timeout,
      llmClientOverride,
    );
  }

  async store(context: ActCacheContext, result: ActResult): Promise<void> {
    if (!this.enabled) return;

    const entry: CachedActEntry = {
      version: 1,
      instruction: context.instruction,
      url: context.pageUrl,
      variableKeys: context.variableKeys,
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
    variableKeys: string[],
  ): string {
    const payload = JSON.stringify({
      instruction,
      url,
      variableKeys,
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  private async replayCachedActions(
    context: ActCacheContext,
    entry: CachedActEntry,
    page: Page,
    timeout?: number,
    llmClientOverride?: LLMClient,
  ): Promise<ActResult> {
    const handler = this.getActHandler();
    if (!handler) {
      throw new StagehandNotInitializedError("act()");
    }
    const effectiveClient = llmClientOverride ?? this.getDefaultLlmClient();

    const execute = async (): Promise<ActResult> => {
      const actionResults: ActResult[] = [];
      for (const action of entry.actions) {
        await waitForCachedSelector({
          page,
          selector: action.selector,
          timeout: this.domSettleTimeoutMs,
          logger: this.logger,
          context: "act",
        });
        const result = await handler.takeDeterministicAction(
          action,
          page,
          this.domSettleTimeoutMs,
          effectiveClient,
          undefined,
          context.variables,
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

      if (
        success &&
        actions.length > 0 &&
        this.haveActionsChanged(entry.actions, actions)
      ) {
        await this.refreshCacheEntry(context, {
          ...entry,
          actions,
          message,
          actionDescription,
        });
      }
      return {
        success,
        message,
        actionDescription,
        actions,
      };
    };

    return await this.runWithTimeout(execute, timeout);
  }

  private haveActionsChanged(original: Action[], updated: Action[]): boolean {
    if (original.length !== updated.length) {
      return true;
    }

    for (let i = 0; i < original.length; i += 1) {
      const orig = original[i];
      const next = updated[i];
      if (!next) {
        return true;
      }

      if (orig.selector !== next.selector) {
        return true;
      }

      if (orig.description !== next.description) {
        return true;
      }

      if ((orig.method ?? "") !== (next.method ?? "")) {
        return true;
      }

      const origArgs = orig.arguments ?? [];
      const nextArgs = next.arguments ?? [];
      if (origArgs.length !== nextArgs.length) {
        return true;
      }

      for (let j = 0; j < origArgs.length; j += 1) {
        if (origArgs[j] !== nextArgs[j]) {
          return true;
        }
      }
    }

    return false;
  }

  private async refreshCacheEntry(
    context: ActCacheContext,
    entry: CachedActEntry,
  ): Promise<void> {
    const { error, path } = await this.storage.writeJson(
      `${context.cacheKey}.json`,
      {
        ...entry,
        variableKeys: context.variableKeys,
      },
    );

    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to update act cache entry after self-heal",
        level: 0,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return;
    }

    this.logger({
      category: "cache",
      message: "act cache entry updated after self-heal",
      level: 2,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        url: { value: context.pageUrl, type: "string" },
      },
    });
  }

  private doVariableKeysMatch(
    entryKeys: string[],
    contextKeys: string[],
  ): boolean {
    if (entryKeys.length !== contextKeys.length) {
      return false;
    }

    for (let i = 0; i < entryKeys.length; i += 1) {
      if (entryKeys[i] !== contextKeys[i]) {
        return false;
      }
    }

    return true;
  }

  private hasAllVariableValues(
    variableKeys: string[],
    variables: Record<string, string>,
  ): boolean {
    for (const key of variableKeys) {
      if (!(key in variables)) {
        return false;
      }
    }
    return true;
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
