import { createHash } from "crypto";
import type { ActHandler } from "../handlers/actHandler";
import type { LLMClient } from "../llm/LLMClient";
import type {
  AgentReplayActStep,
  AgentReplayFillFormStep,
  AgentReplayGotoStep,
  AgentReplayNavBackStep,
  AgentReplayScrollStep,
  AgentReplayStep,
  AgentReplayWaitStep,
  CachedAgentEntry,
  SanitizedAgentExecuteOptions,
  ActFn,
  AgentCacheContext,
  AgentCacheDeps,
} from "../types/private";
import type {
  AvailableModel,
  AgentResult,
  AgentConfig,
  AgentExecuteOptions,
  Logger,
} from "../types/public";
import type { Page } from "../understudy/page";
import type { V3Context } from "../understudy/context";
import { CacheStorage } from "./CacheStorage";
import { cloneForCache, safeGetPageUrl } from "./utils";

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

  private recording: AgentReplayStep[] | null = null;

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
  }

  get enabled(): boolean {
    return this.storage.enabled;
  }

  shouldAttemptCache(instruction: string): boolean {
    return this.enabled && instruction.trim().length > 0;
  }

  sanitizeExecuteOptions(
    options?: AgentExecuteOptions,
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
    return JSON.stringify({
      v3Model: this.getBaseModelName(),
      systemPrompt: this.getSystemPrompt() ?? "",
      agent: {
        cua: agentOptions?.cua ?? false,
        model: serializedModel ?? null,
        executionModel: agentOptions?.cua
          ? null
          : (agentOptions?.executionModel ?? null),
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
  }): Promise<AgentCacheContext | null> {
    if (!this.shouldAttemptCache(params.instruction)) {
      return null;
    }
    const instruction = params.instruction.trim();
    const startUrl = await safeGetPageUrl(params.page);
    const cacheKey = this.buildAgentCacheKey(
      instruction,
      startUrl,
      params.options,
      params.configSignature,
    );
    return {
      instruction,
      startUrl,
      options: params.options,
      configSignature: params.configSignature,
      cacheKey,
    };
  }

  async tryReplay(context: AgentCacheContext): Promise<AgentResult | null> {
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

    return await this.replayAgentCacheEntry(entry);
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
      result: cloneForCache(result),
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
    const options =
      Object.keys(modelOptions).length > 0
        ? (modelOptions as Record<string, unknown>)
        : undefined;
    return options ? { modelName, options } : modelName;
  }

  private buildAgentCacheKey(
    instruction: string,
    startUrl: string,
    options: SanitizedAgentExecuteOptions,
    configSignature: string,
  ): string {
    const payload = {
      instruction,
      startUrl,
      options,
      configSignature,
    };
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private async replayAgentCacheEntry(
    entry: CachedAgentEntry,
  ): Promise<AgentResult | null> {
    const ctx = this.getContext();
    const handler = this.getActHandler();
    if (!ctx || !handler) return null;
    try {
      for (const step of entry.steps ?? []) {
        await this.executeAgentReplayStep(step, ctx, handler);
      }
      const result = cloneForCache(entry.result);
      result.usage = {
        input_tokens: 0,
        output_tokens: 0,
        inference_time_ms: 0,
      };
      result.metadata = {
        ...(result.metadata ?? {}),
        cacheHit: true,
        cacheTimestamp: entry.timestamp,
      };
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
  ): Promise<void> {
    switch (step.type) {
      case "act":
        await this.replayAgentActStep(step as AgentReplayActStep, ctx, handler);
        return;
      case "fillForm":
        await this.replayAgentFillFormStep(
          step as AgentReplayFillFormStep,
          ctx,
          handler,
        );
        return;
      case "goto":
        await this.replayAgentGotoStep(step as AgentReplayGotoStep, ctx);
        return;
      case "scroll":
        await this.replayAgentScrollStep(step as AgentReplayScrollStep, ctx);
        return;
      case "wait":
        await this.replayAgentWaitStep(step as AgentReplayWaitStep);
        return;
      case "navback":
        await this.replayAgentNavBackStep(step as AgentReplayNavBackStep, ctx);
        return;
      case "close":
      case "extract":
      case "screenshot":
      case "ariaTree":
        return;
      default:
        this.logger({
          category: "cache",
          message: `agent cache skipping step type: ${step.type}`,
          level: 2,
        });
    }
  }

  private async replayAgentActStep(
    step: AgentReplayActStep,
    ctx: V3Context,
    handler: ActHandler,
  ): Promise<void> {
    const actions = Array.isArray(step.actions) ? step.actions : [];
    if (actions.length > 0) {
      const page = await ctx.awaitActivePage();
      for (const action of actions) {
        await handler.actFromObserveResult(
          action,
          page,
          this.domSettleTimeoutMs,
          this.getDefaultLlmClient(),
        );
      }
      return;
    }
    await this.act(step.instruction, { timeout: step.timeout });
  }

  private async replayAgentFillFormStep(
    step: AgentReplayFillFormStep,
    ctx: V3Context,
    handler: ActHandler,
  ): Promise<void> {
    const actions =
      Array.isArray(step.actions) && step.actions.length > 0
        ? step.actions
        : (step.observeResults ?? []);
    if (!Array.isArray(actions) || actions.length === 0) return;
    const page = await ctx.awaitActivePage();
    for (const action of actions) {
      await handler.actFromObserveResult(
        action,
        page,
        this.domSettleTimeoutMs,
        this.getDefaultLlmClient(),
      );
    }
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
}
