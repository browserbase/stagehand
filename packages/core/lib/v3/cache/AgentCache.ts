import { createHash } from "crypto";
import type { ActHandler } from "../handlers/actHandler.js";
import type { LLMClient } from "../llm/LLMClient.js";
import type {
  AgentReplayActStep,
  AgentReplayFillFormStep,
  AgentReplayGotoStep,
  AgentReplayKeysStep,
  AgentReplayNavBackStep,
  AgentReplayScrollStep,
  AgentReplayStep,
  AgentReplayWaitStep,
  CachedAgentEntry,
  SanitizedAgentExecuteOptions,
  ActFn,
  AgentCacheContext,
  AgentCacheDeps,
  AgentCacheTransferPayload,
} from "../types/private/index.js";
import type {
  Action,
  AgentResult,
  AgentStreamResult,
  AgentConfig,
  AgentExecuteOptionsBase,
  AvailableModel,
  Logger,
} from "../types/public/index.js";
import type { Page } from "../understudy/page.js";
import type { V3Context } from "../understudy/context.js";
import { CacheStorage } from "./CacheStorage.js";
import {
  cloneForCache,
  safeGetPageUrl,
  waitForCachedSelector,
} from "./utils.js";

const SENSITIVE_CONFIG_KEYS = new Set(["apikey", "api_key", "api-key"]);

export class AgentCache {
  private readonly storage: CacheStorage;
  private readonly logger: Logger;
  private readonly getActHandler: () => ActHandler | null;
  private readonly getContext: () => V3Context | null;
  private readonly getDefaultLlmClient: () => LLMClient;
  private readonly getBaseModelName: () => AvailableModel;
  private readonly getSystemPrompt: () => string | undefined;
  private readonly domSettleTimeoutMs?: number;
  private readonly act: ActFn;
  private readonly bufferLatestEntry: boolean;

  private recording: AgentReplayStep[] | null = null;
  private latestEntry: AgentCacheTransferPayload | null = null;

  constructor({
    storage,
    logger,
    getActHandler,
    getContext,
    getDefaultLlmClient,
    getBaseModelName,
    getSystemPrompt,
    domSettleTimeoutMs,
    act,
    bufferLatestEntry,
  }: AgentCacheDeps) {
    this.storage = storage;
    this.logger = logger;
    this.getActHandler = getActHandler;
    this.getContext = getContext;
    this.getDefaultLlmClient = getDefaultLlmClient;
    this.getBaseModelName = getBaseModelName;
    this.getSystemPrompt = getSystemPrompt;
    this.domSettleTimeoutMs = domSettleTimeoutMs;
    this.act = act;
    this.bufferLatestEntry = bufferLatestEntry ?? false;
  }

  get enabled(): boolean {
    return this.storage.enabled;
  }

  shouldAttemptCache(instruction: string): boolean {
    return this.enabled && instruction.trim().length > 0;
  }

  sanitizeExecuteOptions(
    options?: AgentExecuteOptionsBase,
  ): SanitizedAgentExecuteOptions {
    if (!options) return {};
    const sanitized: SanitizedAgentExecuteOptions = {};
    if (typeof options.maxSteps === "number") {
      sanitized.maxSteps = options.maxSteps;
    }
    if (
      "highlightCursor" in options &&
      typeof (options as { highlightCursor?: unknown }).highlightCursor ===
        "boolean"
    ) {
      sanitized.highlightCursor = (
        options as { highlightCursor?: boolean }
      ).highlightCursor;
    }
    return sanitized;
  }

  buildConfigSignature(agentOptions?: AgentConfig): string {
    const toolKeys = agentOptions?.tools
      ? Object.keys(agentOptions.tools).sort()
      : undefined;
    const integrationSignatures = agentOptions?.integrations
      ? agentOptions.integrations.map((integration) =>
          typeof integration === "string" ? integration : "client",
        )
      : undefined;
    const serializedModel = this.serializeAgentModelForCache(
      agentOptions?.model,
    );
    const serializedExecutionModel = this.serializeAgentModelForCache(
      agentOptions?.executionModel,
    );

    const isCuaMode =
      agentOptions?.mode !== undefined
        ? agentOptions.mode === "cua"
        : agentOptions?.cua === true;

    return JSON.stringify({
      v3Model: this.getBaseModelName(),
      systemPrompt: this.getSystemPrompt() ?? "",
      agent: {
        cua: isCuaMode,
        model: serializedModel ?? null,
        executionModel: isCuaMode ? null : serializedExecutionModel,
        systemPrompt: agentOptions?.systemPrompt ?? null,
        toolKeys,
        integrations: integrationSignatures,
      },
    });
  }

  async prepareContext(params: {
    instruction: string;
    options: SanitizedAgentExecuteOptions;
    configSignature: string;
    page: Page;
    variables?: Record<string, string>;
  }): Promise<AgentCacheContext | null> {
    if (!this.shouldAttemptCache(params.instruction)) {
      return null;
    }
    const instruction = params.instruction.trim();
    const startUrl = await safeGetPageUrl(params.page);
    const variableKeys = params.variables
      ? Object.keys(params.variables).sort()
      : [];
    const cacheKey = this.buildAgentCacheKey(
      instruction,
      startUrl,
      params.options,
      params.configSignature,
      variableKeys,
    );
    return {
      instruction,
      startUrl,
      options: params.options,
      configSignature: params.configSignature,
      cacheKey,
      variableKeys,
      variables: params.variables,
    };
  }

  async tryReplay(
    context: AgentCacheContext,
    llmClientOverride?: LLMClient,
  ): Promise<AgentResult | null> {
    if (!this.enabled) return null;

    const {
      value: entry,
      error,
      path,
    } = await this.storage.readJson<CachedAgentEntry>(
      `agent-${context.cacheKey}.json`,
    );
    if (error && path) {
      this.logger({
        category: "cache",
        message: `failed to read agent cache entry: ${path}`,
        level: 1,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return null;
    }
    if (!entry || entry.version !== 1) {
      return null;
    }

    this.logger({
      category: "cache",
      message: "agent cache hit",
      level: 1,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        url: { value: context.startUrl, type: "string" },
      },
    });

    return await this.replayAgentCacheEntry(context, entry, llmClientOverride);
  }

  /**
   * Attempts to replay a cached agent execution and returns it as a stream result.
   *
   * This method exists because the agent API exposes two execution modes:
   * - `execute()` - Returns a Promise<AgentResult> directly
   * - `stream()` - Returns an AgentStreamResult with async iterables for real-time output
   *
   * When a cache hit occurs, we need to return the appropriate type for each mode:
   * - For `execute()`, we use `tryReplay()` which returns AgentResult
   * - For `stream()`, we use `tryReplayAsStream()` which wraps the result in a
   *   stream-compatible interface
   *
   * This ensures consumers using `stream()` can still iterate over `textStream`
   * and await `result` even when the response comes from cache, maintaining
   * API consistency regardless of whether the result was cached or live.
   */
  async tryReplayAsStream(
    context: AgentCacheContext,
    llmClientOverride?: LLMClient,
  ): Promise<AgentStreamResult | null> {
    const result = await this.tryReplay(context, llmClientOverride);
    if (!result) return null;
    return this.createCachedStreamResult(result);
  }

  /**
   * Creates a mock AgentStreamResult that wraps a cached AgentResult.
   *
   * AgentStreamResult (from the AI SDK) is a complex type with multiple async
   * iterables and promises. When serving from cache, we don't have an actual
   * LLM stream to consume - we just have the final result. This method creates
   * a "fake" stream

   * This approach lets cached responses be transparent to the consumer -
   * they can use the same iteration patterns whether the result is live or cached.
   */
  private createCachedStreamResult(
    cachedResult: AgentResult,
  ): AgentStreamResult {
    const message = cachedResult.message ?? "";

    async function* textStreamGenerator(): AsyncGenerator<string> {
      yield message;
    }

    async function* fullStreamGenerator(): AsyncGenerator<{
      type: string;
      textDelta?: string;
    }> {
      yield { type: "text-delta", textDelta: message };
      yield { type: "finish" };
    }

    const mockStreamResult = {
      textStream: textStreamGenerator(),
      fullStream: fullStreamGenerator(),
      result: Promise.resolve(cachedResult),
      text: Promise.resolve(message),
      usage: Promise.resolve({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }),
      finishReason: Promise.resolve("stop" as const),
      experimental_providerMetadata: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "cached",
        timestamp: new Date(),
        modelId: "cached",
      }),
      rawResponse: Promise.resolve({ headers: {} }),
      warnings: Promise.resolve([]),
      steps: Promise.resolve([]),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      [Symbol.asyncIterator]: () => textStreamGenerator(),
    } as unknown as AgentStreamResult;

    return mockStreamResult;
  }

  /**
   * Wraps an AgentStreamResult with caching logic.
   *
   * This method handles the complexity of caching for streaming responses:
   * 1. Begins recording agent replay steps
   * 2. Wraps the stream's result promise to capture completion
   * 3. On success: ends recording and stores the cache entry
   * 4. On error: discards the recording
   *
   * This keeps the caching orchestration in AgentCache rather than
   * spreading it across the V3 class.
   *
   * @param context - The cache context for this execution
   * @param streamResult - The stream result from the agent handler
   * @param beginRecording - Callback to start recording (from V3)
   * @param endRecording - Callback to end recording and get steps (from V3)
   * @param discardRecording - Callback to discard recording on error (from V3)
   * @returns The wrapped stream result with caching enabled
   */
  wrapStreamForCaching(
    context: AgentCacheContext,
    streamResult: AgentStreamResult,
    beginRecording: () => void,
    endRecording: () => AgentReplayStep[],
    discardRecording: () => void,
  ): AgentStreamResult {
    beginRecording();

    const originalResultPromise = streamResult.result;
    const wrappedResultPromise = originalResultPromise.then(
      async (result) => {
        const agentSteps = endRecording();

        if (result.success && agentSteps.length > 0) {
          await this.store(context, agentSteps, result);
        }

        return result;
      },
      (error) => {
        discardRecording();
        throw error;
      },
    );

    streamResult.result = wrappedResultPromise;
    return streamResult;
  }

  async store(
    context: AgentCacheContext,
    steps: AgentReplayStep[],
    result: AgentResult,
  ): Promise<void> {
    if (!this.enabled) return;

    const entry: CachedAgentEntry = {
      version: 1,
      instruction: context.instruction,
      startUrl: context.startUrl,
      options: context.options,
      configSignature: context.configSignature,
      steps: cloneForCache(steps),
      result: this.pruneAgentResult(result),
      timestamp: new Date().toISOString(),
    };

    const { error, path } = await this.storage.writeJson(
      `agent-${context.cacheKey}.json`,
      entry,
    );
    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to write agent cache entry",
        level: 1,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return;
    }

    this.logger({
      category: "cache",
      message: "agent cache stored",
      level: 2,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        steps: { value: String(steps.length), type: "string" },
      },
    });

    if (this.bufferLatestEntry) {
      this.latestEntry = {
        cacheKey: context.cacheKey,
        entry: cloneForCache(entry),
      };
    }
  }

  consumeBufferedEntry(): AgentCacheTransferPayload | null {
    if (!this.bufferLatestEntry || !this.latestEntry) {
      return null;
    }

    const payload = this.latestEntry;
    this.latestEntry = null;
    return payload;
  }

  async storeTransferredEntry(
    payload: AgentCacheTransferPayload | null,
  ): Promise<void> {
    if (!this.enabled || !payload) return;

    const entry = cloneForCache(payload.entry);
    const { error, path } = await this.storage.writeJson(
      `agent-${payload.cacheKey}.json`,
      entry,
    );
    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to import remote agent cache entry",
        level: 0,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return;
    }

    this.logger({
      category: "cache",
      message: "agent cache imported from server",
      level: 2,
      auxiliary: {
        instruction: { value: entry.instruction, type: "string" },
        steps: { value: String(entry.steps?.length ?? 0), type: "string" },
      },
    });
  }

  /**
   * Clone the agent result and prune bulky fields (e.g. screenshot base64 blobs)
   * before persisting it to disk. This keeps cache entries compact without
   * mutating the live AgentResult returned to callers.
   */
  private pruneAgentResult(result: AgentResult): AgentResult {
    const cloned = cloneForCache(result);
    if (!Array.isArray(cloned.actions)) {
      return cloned;
    }

    for (const action of cloned.actions) {
      if (action?.type === "screenshot") {
        delete action.base64;
      }
    }

    return cloned;
  }

  beginRecording(): void {
    this.recording = [];
  }

  endRecording(): AgentReplayStep[] {
    if (!this.recording) return [];
    const steps = cloneForCache(this.recording);
    this.recording = null;
    return steps;
  }

  discardRecording(): void {
    this.recording = null;
  }

  isRecording(): boolean {
    return Array.isArray(this.recording);
  }

  recordStep(step: AgentReplayStep): void {
    if (!this.isRecording()) return;
    try {
      this.recording!.push(cloneForCache(step));
    } catch (err) {
      this.logger({
        category: "cache",
        message: "failed to record agent replay step",
        level: 2,
        auxiliary: {
          error: { value: String(err), type: "string" },
        },
      });
    }
  }

  isReplayActive(): boolean {
    return this.isRecording();
  }

  private serializeAgentModelForCache(
    model?: AgentConfig["model"],
  ): null | string | { modelName: string; options?: Record<string, unknown> } {
    if (!model) return null;
    if (typeof model === "string") return model;

    const { modelName, ...modelOptions } = model;
    const sanitizedOptions =
      Object.keys(modelOptions).length > 0
        ? this.sanitizeModelOptionsForCache(
            modelOptions as Record<string, unknown>,
          )
        : undefined;
    return sanitizedOptions
      ? { modelName, options: sanitizedOptions }
      : modelName;
  }

  private buildAgentCacheKey(
    instruction: string,
    startUrl: string,
    options: SanitizedAgentExecuteOptions,
    configSignature: string,
    variableKeys?: string[],
  ): string {
    const payload = {
      instruction,
      startUrl,
      options,
      configSignature,
      variableKeys: variableKeys ?? [],
    };
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private sanitizeModelOptionsForCache(
    value: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const sanitizedEntries: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      if (SENSITIVE_CONFIG_KEYS.has(key.toLowerCase())) {
        continue;
      }

      const sanitizedValue = this.sanitizeModelValueForCache(rawValue);
      if (sanitizedValue !== undefined) {
        sanitizedEntries[key] = sanitizedValue;
      }
    }

    return Object.keys(sanitizedEntries).length > 0
      ? sanitizedEntries
      : undefined;
  }

  private sanitizeModelValueForCache(value: unknown): unknown {
    if (Array.isArray(value)) {
      const sanitizedArray = value
        .map((item) => this.sanitizeModelValueForCache(item))
        .filter((item) => item !== undefined);
      return sanitizedArray;
    }

    if (value && typeof value === "object") {
      return this.sanitizeModelOptionsForCache(
        value as Record<string, unknown>,
      );
    }

    return value;
  }

  private async replayAgentCacheEntry(
    context: AgentCacheContext,
    entry: CachedAgentEntry,
    llmClientOverride?: LLMClient,
  ): Promise<AgentResult | null> {
    const ctx = this.getContext();
    const handler = this.getActHandler();
    if (!ctx || !handler) return null;
    const effectiveClient = llmClientOverride ?? this.getDefaultLlmClient();
    try {
      const updatedSteps: AgentReplayStep[] = [];
      let stepsChanged = false;
      for (const step of entry.steps ?? []) {
        const replayedStep =
          (await this.executeAgentReplayStep(
            step,
            ctx,
            handler,
            effectiveClient,
            context.variables,
          )) ?? step;
        stepsChanged ||= replayedStep !== step;
        updatedSteps.push(replayedStep);
      }
      const result = cloneForCache(entry.result);
      result.usage = {
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
        inference_time_ms: 0,
      };
      result.metadata = {
        ...(result.metadata ?? {}),
        cacheHit: true,
        cacheTimestamp: entry.timestamp,
      };
      if (stepsChanged) {
        await this.refreshAgentCacheEntry(context, entry, updatedSteps);
      }
      return result;
    } catch (err) {
      this.logger({
        category: "cache",
        message: "agent cache replay failed",
        level: 1,
        auxiliary: {
          error: { value: String(err), type: "string" },
        },
      });
      return null;
    }
  }

  private async executeAgentReplayStep(
    step: AgentReplayStep,
    ctx: V3Context,
    handler: ActHandler,
    llmClient: LLMClient,
    variables?: Record<string, string>,
  ): Promise<AgentReplayStep> {
    switch (step.type) {
      case "act":
        return await this.replayAgentActStep(
          step as AgentReplayActStep,
          ctx,
          handler,
          llmClient,
          variables,
        );
      case "fillForm":
        return await this.replayAgentFillFormStep(
          step as AgentReplayFillFormStep,
          ctx,
          handler,
          llmClient,
          variables,
        );
      case "goto":
        await this.replayAgentGotoStep(step as AgentReplayGotoStep, ctx);
        return step;
      case "scroll":
        await this.replayAgentScrollStep(step as AgentReplayScrollStep, ctx);
        return step;
      case "wait":
        await this.replayAgentWaitStep(step as AgentReplayWaitStep);
        return step;
      case "navback":
        await this.replayAgentNavBackStep(step as AgentReplayNavBackStep, ctx);
        return step;
      case "keys":
        await this.replayAgentKeysStep(step as AgentReplayKeysStep, ctx);
        return step;
      case "done":
      case "extract":
      case "screenshot":
      case "ariaTree":
        return step;
      default:
        this.logger({
          category: "cache",
          message: `agent cache skipping step type: ${step.type}`,
          level: 2,
        });
        return step;
    }
  }

  private async replayAgentActStep(
    step: AgentReplayActStep,
    ctx: V3Context,
    handler: ActHandler,
    llmClient: LLMClient,
    variables?: Record<string, string>,
  ): Promise<AgentReplayActStep> {
    const actions = Array.isArray(step.actions) ? step.actions : [];
    if (actions.length > 0) {
      const page = await ctx.awaitActivePage();
      const updatedActions: Action[] = [];
      for (const action of actions) {
        await waitForCachedSelector({
          page,
          selector: action.selector,
          timeout: this.domSettleTimeoutMs,
          logger: this.logger,
          context: "agent act",
        });
        const result = await handler.takeDeterministicAction(
          action,
          page,
          this.domSettleTimeoutMs,
          llmClient,
          undefined,
          variables,
        );
        if (result.success && Array.isArray(result.actions)) {
          updatedActions.push(...cloneForCache(result.actions));
        } else {
          updatedActions.push(cloneForCache(action));
        }
      }
      if (this.haveActionsChanged(actions, updatedActions)) {
        return { ...step, actions: updatedActions };
      }
      return step;
    }
    await this.act(step.instruction, { timeout: step.timeout, variables });
    return step;
  }

  private async replayAgentFillFormStep(
    step: AgentReplayFillFormStep,
    ctx: V3Context,
    handler: ActHandler,
    llmClient: LLMClient,
    variables?: Record<string, string>,
  ): Promise<AgentReplayFillFormStep> {
    const actions =
      Array.isArray(step.actions) && step.actions.length > 0
        ? step.actions
        : (step.observeResults ?? []);
    if (!Array.isArray(actions) || actions.length === 0) {
      return step;
    }
    const page = await ctx.awaitActivePage();
    const updatedActions: Action[] = [];
    for (const action of actions) {
      await waitForCachedSelector({
        page,
        selector: action.selector,
        timeout: this.domSettleTimeoutMs,
        logger: this.logger,
        context: "fillForm",
      });
      const result = await handler.takeDeterministicAction(
        action,
        page,
        this.domSettleTimeoutMs,
        llmClient,
        undefined, // ensureTimeRemaining is not used in this context
        variables,
      );
      if (result.success && Array.isArray(result.actions)) {
        updatedActions.push(...cloneForCache(result.actions));
      } else {
        updatedActions.push(cloneForCache(action));
      }
    }
    if (this.haveActionsChanged(actions, updatedActions)) {
      return { ...step, actions: updatedActions };
    }
    return step;
  }

  private async replayAgentGotoStep(
    step: AgentReplayGotoStep,
    ctx: V3Context,
  ): Promise<void> {
    const page = await ctx.awaitActivePage();
    await page.goto(step.url, { waitUntil: step.waitUntil ?? "load" });
  }

  private async replayAgentScrollStep(
    step: AgentReplayScrollStep,
    ctx: V3Context,
  ): Promise<void> {
    const page = await ctx.awaitActivePage();
    let anchor = step.anchor;
    if (!anchor) {
      anchor = await page
        .mainFrame()
        .evaluate<{ x: number; y: number }>(() => ({
          x: Math.max(0, Math.floor(window.innerWidth / 2)),
          y: Math.max(0, Math.floor(window.innerHeight / 2)),
        }));
    }
    const deltaX = step.deltaX ?? 0;
    const deltaY = step.deltaY ?? 0;
    await page.scroll(
      Math.round(anchor.x ?? 0),
      Math.round(anchor.y ?? 0),
      deltaX,
      deltaY,
    );
  }

  private async replayAgentWaitStep(step: AgentReplayWaitStep): Promise<void> {
    if (!step.timeMs || step.timeMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, step.timeMs));
  }

  private async replayAgentNavBackStep(
    step: AgentReplayNavBackStep,
    ctx: V3Context,
  ): Promise<void> {
    const page = await ctx.awaitActivePage();
    await page.goBack({ waitUntil: step.waitUntil ?? "domcontentloaded" });
  }

  private async replayAgentKeysStep(
    step: AgentReplayKeysStep,
    ctx: V3Context,
  ): Promise<void> {
    const page = await ctx.awaitActivePage();
    const { method, text, keys, times } = step.playwrightArguments;
    const repeatCount = Math.max(1, times ?? 1);

    if (method === "type" && text) {
      for (let i = 0; i < repeatCount; i++) {
        await page.type(text, { delay: 100 });
      }
    } else if (method === "press" && keys) {
      for (let i = 0; i < repeatCount; i++) {
        await page.keyPress(keys, { delay: 100 });
      }
    }
  }

  private haveActionsChanged(original: Action[], updated: Action[]): boolean {
    if (original.length !== updated.length) {
      return true;
    }
    for (let i = 0; i < original.length; i += 1) {
      const orig = original[i];
      const next = updated[i];
      if (!orig || !next) {
        return true;
      }
      if (orig.selector !== next.selector) {
        return true;
      }
      if ((orig.description ?? "") !== (next.description ?? "")) {
        return true;
      }
      if ((orig.method ?? "") !== (next.method ?? "")) {
        return true;
      }
      const origArgs = Array.isArray(orig.arguments) ? orig.arguments : [];
      const nextArgs = Array.isArray(next.arguments) ? next.arguments : [];
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

  private async refreshAgentCacheEntry(
    context: AgentCacheContext,
    entry: CachedAgentEntry,
    updatedSteps: AgentReplayStep[],
  ): Promise<void> {
    const updatedEntry: CachedAgentEntry = {
      ...entry,
      steps: cloneForCache(updatedSteps),
      timestamp: new Date().toISOString(),
    };
    const { error, path } = await this.storage.writeJson(
      `agent-${context.cacheKey}.json`,
      updatedEntry,
    );
    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to update agent cache entry after self-heal",
        level: 0,
        auxiliary: {
          error: { value: String(error), type: "string" },
        },
      });
      return;
    }
    this.logger({
      category: "cache",
      message: "agent cache entry updated after self-heal",
      level: 2,
      auxiliary: {
        instruction: { value: context.instruction, type: "string" },
        steps: { value: String(updatedSteps.length), type: "string" },
      },
    });
  }
}
