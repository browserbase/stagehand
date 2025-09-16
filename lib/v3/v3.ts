import {
  V3Options,
  InitState,
  PlaywrightPage,
  PuppeteerPage,
  ActParams,
  ActHandlerParams,
  ExtractHandlerParams,
  ExtractParams,
  ObserveParams,
  ObserveHandlerParams,
  AnyPage,
  V3Metrics,
  V3FunctionName,
} from "@/lib/v3/types";
import { ActHandler } from "./handlers/actHandler";
import { ExtractHandler } from "./handlers/extractHandler";
import { ObserveHandler } from "./handlers/observeHandler";
import { V3Context } from "@/lib/v3/understudy/context";
import { Page } from "./understudy/page";
import { LLMClient } from "@/lib/llm/LLMClient";
import { AvailableModel } from "@/types/model";
import { ClientOptions } from "../../types/model";
import { LLMProvider } from "@/lib/llm/LLMProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import dotenv from "dotenv";
import { z } from "zod/v3";
import { defaultExtractSchema, pageTextSchema } from "../v3/types";
import {
  ObserveResult,
  ActResult,
  HistoryEntry,
  AgentConfig,
} from "@/types/stagehand";
import { AgentExecuteOptions, AgentResult } from "@/types/agent";
import {
  initV3Logger,
  bindInstanceLogger,
  unbindInstanceLogger,
  withInstanceLogContext,
  v3Logger,
} from "./logger";
import { LogLine } from "@/types/log";
import { launchLocalChrome } from "./launch/local";
import { createBrowserbaseSession } from "./launch/browserbase";
import process from "process";
import { V3AgentHandler } from "@/lib/v3/handlers/v3AgentHandler";
import { V3CuaAgentHandler } from "@/lib/v3/handlers/v3CuaAgentHandler";
import { resolveTools } from "@/lib/mcp/utils";

const DEFAULT_MODEL_NAME = "openai/gpt-4.1-mini";
dotenv.config({ path: ".env" });

/**
 * V3
 *
 * Purpose:
 * A high-level orchestrator for Stagehand V3. Abstracts away whether the browser
 * runs **locally via Chrome** or remotely on **Browserbase**, and exposes simple
 * entrypoints (`act`, `extract`, `observe`) that delegate to the corresponding
 * handler classes.
 *
 * Responsibilities:
 * - Bootstraps Chrome or Browserbase, ensures a working CDP WebSocket, and builds a `V3Context`.
 * - Manages lifecycle: init, context access, cleanup.
 * - Bridges external page objects (Playwright/Puppeteer) into internal frameIds for handlers.
 * - Provides a stable API surface for downstream code regardless of runtime environment.
 */
export class V3 {
  private readonly opts: V3Options;
  private state: InitState = { kind: "UNINITIALIZED" };
  private actHandler: ActHandler | null = null;
  private extractHandler: ExtractHandler | null = null;
  private observeHandler: ObserveHandler | null = null;
  private ctx: V3Context | null = null;
  public llmClient!: LLMClient;
  private modelName: AvailableModel;
  private modelClientOptions: ClientOptions;
  private llmProvider: LLMProvider;
  private _isClosing = false;
  private _onCdpClosed = (why: string) => {
    // Single place to react to the transport closing
    this._immediateShutdown(`CDP transport closed: ${why}`).catch(() => {});
  };
  public readonly experimental: boolean = false;
  public readonly logInferenceToFile: boolean = false;

  private externalLogger?: (logLine: LogLine) => void;
  public verbose: 0 | 1 | 2 = 1;
  private _history: Array<HistoryEntry> = [];
  private readonly instanceId: string;
  private static _processGuardsInstalled = false;
  private static _instances: Set<V3> = new Set();

  public v3Metrics: V3Metrics = {
    actPromptTokens: 0,
    actCompletionTokens: 0,
    actInferenceTimeMs: 0,
    extractPromptTokens: 0,
    extractCompletionTokens: 0,
    extractInferenceTimeMs: 0,
    observePromptTokens: 0,
    observeCompletionTokens: 0,
    observeInferenceTimeMs: 0,
    agentPromptTokens: 0,
    agentCompletionTokens: 0,
    agentInferenceTimeMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalInferenceTimeMs: 0,
  };

  /**
   * Async property for metrics so callers can `await v3.metrics`.
   * Returning a Promise future-proofs async aggregation/storage.
   */
  public get metrics(): Promise<V3Metrics> {
    return Promise.resolve(this.v3Metrics);
  }

  /**
   * Async property for history so callers can `await v3.history`.
   * Returns a frozen copy to avoid external mutation.
   */
  public get history(): Promise<ReadonlyArray<HistoryEntry>> {
    return Promise.resolve(Object.freeze([...this._history]));
  }

  public addToHistory(
    method: HistoryEntry["method"],
    parameters: unknown,
    result?: unknown,
  ): void {
    this._history.push({
      method,
      parameters,
      result: result ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  public updateMetrics(
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ): void {
    switch (functionName) {
      case V3FunctionName.ACT:
        this.v3Metrics.actPromptTokens += promptTokens;
        this.v3Metrics.actCompletionTokens += completionTokens;
        this.v3Metrics.actInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.EXTRACT:
        this.v3Metrics.extractPromptTokens += promptTokens;
        this.v3Metrics.extractCompletionTokens += completionTokens;
        this.v3Metrics.extractInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.OBSERVE:
        this.v3Metrics.observePromptTokens += promptTokens;
        this.v3Metrics.observeCompletionTokens += completionTokens;
        this.v3Metrics.observeInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.AGENT:
        this.v3Metrics.agentPromptTokens += promptTokens;
        this.v3Metrics.agentCompletionTokens += completionTokens;
        this.v3Metrics.agentInferenceTimeMs += inferenceTimeMs;
        break;
    }
    this.updateTotalMetrics(promptTokens, completionTokens, inferenceTimeMs);
  }

  private updateTotalMetrics(
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ): void {
    this.v3Metrics.totalPromptTokens += promptTokens;
    this.v3Metrics.totalCompletionTokens += completionTokens;
    this.v3Metrics.totalInferenceTimeMs += inferenceTimeMs;
  }

  constructor(opts: V3Options) {
    V3._installProcessGuards();
    this.externalLogger = opts.logger;
    this.verbose = opts.verbose ?? 1;
    this.instanceId =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    // Initialize the global v3 logger (fire-and-forget)
    void initV3Logger({
      verbose: this.verbose,
      disablePino: opts.disablePino,
      pretty: true,
    });
    if (this.externalLogger) {
      try {
        bindInstanceLogger(this.instanceId, this.externalLogger);
      } catch {
        // ignore
      }
    }
    this.modelName = opts.modelName ?? DEFAULT_MODEL_NAME;
    this.experimental = opts.experimental ?? false;
    this.logInferenceToFile = opts.logInferenceToFile ?? false;
    this.llmProvider = new LLMProvider(
      this.logger,
      opts.enableCaching ?? false,
    );
    if (opts.llmClient) {
      this.llmClient = opts.llmClient;
      this.modelClientOptions = opts.modelClientOptions ?? {};
    } else {
      // Ensure API key is set
      let apiKey = opts.modelClientOptions?.apiKey;
      if (!apiKey) {
        apiKey = loadApiKeyFromEnv(
          this.modelName.split("/")[0], // "openai", "anthropic", etc
          this.logger,
        );
      }
      this.modelClientOptions = { ...opts.modelClientOptions, apiKey };

      // Get the default client for this model
      this.llmClient = this.llmProvider.getClient(
        this.modelName,
        this.modelClientOptions,
      );
    }
    this.opts = opts;
    // Track instance for global process guard handling
    V3._instances.add(this);
  }

  private async _immediateShutdown(reason: string): Promise<void> {
    try {
      this.logger({
        category: "v3",
        message: `initiating shutdown → ${reason}`,
        level: 0,
      });
    } catch {
      //
    }

    try {
      this.logger({
        category: "v3",
        message: `closing resources → ${reason}`,
        level: 0,
      });
      await this.close({ force: true });
    } catch {
      // swallow — already shutting down
    }
  }

  private static _installProcessGuards(): void {
    if (V3._processGuardsInstalled) return;
    V3._processGuardsInstalled = true;

    const shutdownAllImmediate = async (reason: string) => {
      const instances = Array.from(V3._instances);
      await Promise.all(instances.map((i) => i._immediateShutdown(reason)));
    };

    const exitAfter = async (label: string) => {
      try {
        // Give all instances up to 3s to close
        await Promise.race([
          (async () => {
            const instances = Array.from(V3._instances);
            await Promise.all(instances.map((i) => i.close({ force: true })));
          })(),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } finally {
        v3Logger({
          category: "v3",
          message: `${label}: shutdown complete`,
          level: 0,
        });
        process.exit(1);
      }
    };

    process.once("SIGINT", () => {
      v3Logger({
        category: "v3",
        message: "SIGINT: initiating shutdown",
        level: 0,
      });
      void shutdownAllImmediate("signal SIGINT");
      void exitAfter("SIGINT");
    });
    process.once("SIGTERM", () => {
      v3Logger({
        category: "v3",
        message: "SIGTERM: initiating shutdown",
        level: 0,
      });
      void shutdownAllImmediate("signal SIGTERM");
      void exitAfter("SIGTERM");
    });
    process.once("uncaughtException", (err: unknown) => {
      v3Logger({
        category: "v3",
        message: "uncaughtException",
        level: 0,
        auxiliary: { err: { value: String(err), type: "string" } },
      });
      void exitAfter("uncaughtException");
    });
    process.once("unhandledRejection", (reason: unknown) => {
      v3Logger({
        category: "v3",
        message: "unhandledRejection",
        level: 0,
        auxiliary: { reason: { value: String(reason), type: "string" } },
      });
      void exitAfter("unhandledRejection");
    });
  }

  /**
   * Entrypoint: initializes handlers, launches Chrome or Browserbase,
   * and sets up a CDP context.
   */
  async init(): Promise<void> {
    return await withInstanceLogContext(this.instanceId, async () => {
      this.actHandler = new ActHandler(
        this.llmClient,
        this.modelName,
        this.modelClientOptions,
        this.opts.systemPrompt ?? "",
        this.logInferenceToFile,
        this.opts.selfHeal ?? false,
        (functionName, promptTokens, completionTokens, inferenceTimeMs) =>
          this.updateMetrics(
            functionName,
            promptTokens,
            completionTokens,
            inferenceTimeMs,
          ),
      );
      this.extractHandler = new ExtractHandler(
        this.llmClient,
        this.modelName,
        this.modelClientOptions,
        this.opts.systemPrompt ?? "",
        this.logInferenceToFile,
        this.experimental,
        (functionName, promptTokens, completionTokens, inferenceTimeMs) =>
          this.updateMetrics(
            functionName,
            promptTokens,
            completionTokens,
            inferenceTimeMs,
          ),
      );
      this.observeHandler = new ObserveHandler(
        this.llmClient,
        this.modelName,
        this.modelClientOptions,
        this.opts.systemPrompt ?? "",
        this.logInferenceToFile,
        this.experimental,
        (functionName, promptTokens, completionTokens, inferenceTimeMs) =>
          this.updateMetrics(
            functionName,
            promptTokens,
            completionTokens,
            inferenceTimeMs,
          ),
      );
      if (this.opts.env === "LOCAL") {
        // chrome-launcher conditionally adds --headless when the environment variable
        // HEADLESS is set, without parsing its value.
        // if it is not equal to true, then we delete it from the process
        const envHeadless = process.env.HEADLESS;
        if (envHeadless !== undefined) {
          const normalized = envHeadless.trim().toLowerCase();
          if (normalized !== "true") {
            delete process.env.HEADLESS;
          }
        }

        const { ws, chrome } = await launchLocalChrome({
          chromePath: this.opts.chromePath,
          chromeFlags: this.opts.chromeFlags,
          headless: this.opts.headless,
          userDataDir: this.opts.userDataDir,
          connectTimeoutMs: this.opts.connectTimeoutMs,
        });
        this.ctx = await V3Context.create(ws, {
          includeCursor: this.opts.includeCursor ?? false,
          env: "LOCAL",
        });
        this.ctx.conn.onTransportClosed(this._onCdpClosed);
        this.state = { kind: "LOCAL", chrome, ws };
        return;
      }

      if (this.opts.env === "BROWSERBASE") {
        const { apiKey, projectId } = this.requireBrowserbaseCreds();
        const { ws, sessionId, bb } = await createBrowserbaseSession(
          apiKey,
          projectId,
          this.opts.browserbaseSessionCreateParams,
          this.opts.browserbaseSessionID,
        );
        this.ctx = await V3Context.create(ws, {
          includeCursor: this.opts.includeCursor ?? false,
          env: "BROWSERBASE",
        });
        this.ctx.conn.onTransportClosed(this._onCdpClosed);
        this.state = { kind: "BROWSERBASE", sessionId, ws, bb };

        try {
          const resumed = !!this.opts.browserbaseSessionID;
          let debugUrl: string | undefined;
          try {
            const dbg = (await bb.sessions.debug(sessionId)) as unknown as {
              debuggerUrl?: string;
            };
            debugUrl = dbg?.debuggerUrl;
          } catch {
            // Ignore debug fetch failures; continue with sessionUrl only
          }
          const sessionUrl = `https://www.browserbase.com/sessions/${sessionId}`;
          this.logger({
            category: "init",
            message: resumed
              ? "browserbase session resumed"
              : "browserbase session started",
            level: 1,
            auxiliary: {
              sessionUrl: { value: sessionUrl, type: "string" },
              ...(debugUrl && {
                debugUrl: { value: debugUrl, type: "string" },
              }),
              sessionId: { value: sessionId, type: "string" },
            },
          });
        } catch {
          // best-effort logging — ignore failures
        }
        return;
      }

      const neverEnv: never = this.opts.env;
      throw new Error(`Unsupported env: ${neverEnv}`);
    });
  }

  /**
   * Run an "act" instruction through the ActHandler.
   * Optional: narrow to a specific page (Playwright/Puppeteer).
   */
  async act(params: ActParams): Promise<ActResult>;
  async act(
    instruction: string,
    page?: AnyPage,
    opts?: { domSettleTimeoutMs?: number; timeoutMs?: number },
  ): Promise<ActResult>;
  async act(
    observe: ObserveResult,
    page?: AnyPage,
    opts?: { domSettleTimeoutMs?: number; timeoutMs?: number },
  ): Promise<ActResult>;

  async act(
    input: ActParams | ObserveResult | string,
    pageArg?: AnyPage,
    opts?: { domSettleTimeoutMs?: number; timeoutMs?: number },
  ): Promise<ActResult> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.actHandler)
        throw new Error("V3 not initialized. Call init() before act().");

      // String shorthand → ActParams
      if (typeof input === "string") {
        const p: ActParams = {
          instruction: input,
          page: pageArg,
          domSettleTimeoutMs: opts?.domSettleTimeoutMs,
          timeoutMs: opts?.timeoutMs,
        };
        return this.act(p);
      }

      if (isObserveResult(input)) {
        // Resolve page: use provided page if any, otherwise default active page
        let v3Page: Page;
        if (pageArg) {
          v3Page = await this.normalizeToV3Page(pageArg);
        } else {
          v3Page = await this.ctx!.awaitActivePage();
        }

        // normalize selector to the engine your executor expects
        const selector = input.selector.startsWith("xpath=")
          ? input.selector
          : `xpath=${input.selector}`;
        const actResult = await this.actHandler.actFromObserveResult(
          { ...input, selector }, // ObserveResult
          v3Page, // V3 Page
          opts?.domSettleTimeoutMs,
        );
        // history: record ObserveResult-based act call
        this.addToHistory(
          "act",
          {
            observeResult: input,
            domSettleTimeoutMs: opts?.domSettleTimeoutMs,
          },
          actResult,
        );
        return actResult;
      }
      const params = input as ActParams;

      let page: Page;

      if (params.page) {
        if (params.page instanceof (await import("./understudy/page")).Page) {
          // Already a V3 Page
          page = params.page;
        } else {
          // Playwright / Puppeteer path: resolve → frameId → V3 Page
          const frameId = await this.resolveTopFrameId(params.page);
          page = this.ctx!.resolvePageByMainFrameId(frameId);
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

      const handlerParams: ActHandlerParams = {
        instruction: params.instruction,
        page: page!,
        variables: params.variables,
        domSettleTimeoutMs: params.domSettleTimeoutMs,
        timeoutMs: params.timeoutMs,
      };
      const actResult = await this.actHandler.act(handlerParams);
      // history: record instruction-based act call (omit page object)
      this.addToHistory(
        "act",
        {
          instruction: params.instruction,
          variables: params.variables,
          domSettleTimeoutMs: params.domSettleTimeoutMs,
          timeoutMs: params.timeoutMs,
        },
        actResult,
      );
      return actResult;
    });
  }

  /**
   * Run an "extract" instruction through the ExtractHandler.
   *
   * Overloads mirror StagehandPage.extract typing:
   * - No args → returns page text shape.
   * - String or options → defaults schema to defaultExtractSchema unless provided.
   */

  async extract(): Promise<z.infer<typeof pageTextSchema>>;
  // If a page is provided but no instruction and no schema, return page text shape
  async extract(
    params: Omit<ExtractParams<z.AnyZodObject>, "instruction" | "schema"> & {
      page: AnyPage;
      instruction?: undefined;
      schema?: undefined;
    },
  ): Promise<z.infer<typeof pageTextSchema>>;
  // Generic schema path
  async extract<T extends z.AnyZodObject = typeof defaultExtractSchema>(
    params: ExtractParams<T>,
  ): Promise<z.infer<T>>;
  async extract<T extends z.AnyZodObject = typeof defaultExtractSchema>(
    instruction: string,
    page?: AnyPage,
  ): Promise<z.infer<T>>;

  async extract<T extends z.AnyZodObject = typeof defaultExtractSchema>(
    params?: ExtractParams<T> | string,
    pageArg?: AnyPage,
  ): Promise<z.infer<T> | z.infer<typeof pageTextSchema>> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.extractHandler) {
        throw new Error("V3 not initialized. Call init() before extract().");
      }

      // String shorthand → ExtractParams with instruction only
      if (typeof params === "string") {
        const p = {
          instruction: params,
          page: pageArg,
        } as ExtractParams<z.AnyZodObject>;
        // Re-enter with normalized params
        return this.extract(p);
      }

      let page: Page;
      if (params?.page) {
        if (params.page instanceof (await import("./understudy/page")).Page) {
          // Already a V3 Page
          page = params.page;
        } else {
          // Playwright / Puppeteer path: resolve → frameId → V3 Page
          const frameId = await this.resolveTopFrameId(params.page);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

      const noArgs = !params?.instruction && !params?.schema;
      const onlyInstruction = !!params?.instruction && !params?.schema;

      const effectiveSchema: T | undefined = noArgs
        ? undefined
        : onlyInstruction
          ? (defaultExtractSchema as unknown as T)
          : (params?.schema as T);

      const handlerParams: ExtractHandlerParams<T> = {
        instruction: params?.instruction,
        schema: effectiveSchema,
        modelName: params?.modelName,
        modelClientOptions: params?.modelClientOptions,
        domSettleTimeoutMs: params?.domSettleTimeoutMs,
        selector: params?.selector,
        page: page!,
      };

      const result = await this.extractHandler.extract<T>(handlerParams);
      // history: record extract call (omit page object and raw schema instance to avoid heavy serialization)
      this.addToHistory(
        "extract",
        {
          instruction: params?.instruction,
          // best-effort: log presence of schema without serializing the full instance
          hasSchema: !!params?.schema,
          domSettleTimeoutMs: params?.domSettleTimeoutMs,
        },
        result,
      );
      return result;
    });
  }

  /**
   * Run an "observe" instruction through the ObserveHandler.
   */
  async observe(): Promise<ObserveResult[]>;
  async observe(params: ObserveParams): Promise<ObserveResult[]>;
  async observe(
    instruction: string,
    page?: AnyPage,
    opts?: {
      domSettleTimeoutMs?: number;
      returnAction?: boolean;
      drawOverlay?: boolean;
    },
  ): Promise<ObserveResult[]>;
  async observe(
    params?: ObserveParams | string,
    pageArg?: AnyPage,
    opts?: {
      domSettleTimeoutMs?: number;
      returnAction?: boolean;
      drawOverlay?: boolean;
    },
  ): Promise<ObserveResult[]> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.observeHandler) {
        throw new Error("V3 not initialized. Call init() before observe().");
      }

      let effective: ObserveParams;
      if (typeof params === "string") {
        effective = {
          instruction: params,
          page: pageArg,
          domSettleTimeoutMs: opts?.domSettleTimeoutMs,
          returnAction: opts?.returnAction,
          drawOverlay: opts?.drawOverlay,
        };
      } else {
        effective = params || {};
      }

      // Resolve to our internal Page type
      let page: Page;
      if (effective.page) {
        if (
          effective.page instanceof (await import("./understudy/page")).Page
        ) {
          page = effective.page;
        } else {
          const frameId = await this.resolveTopFrameId(effective.page);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

      const handlerParams: ObserveHandlerParams = {
        instruction: effective.instruction,
        domSettleTimeoutMs: effective.domSettleTimeoutMs,
        returnAction: effective.returnAction,
        drawOverlay: effective.drawOverlay,
        fromAct: false,
        page,
      };

      const results = await this.observeHandler.observe(handlerParams);
      // history: record observe call (omit page object)
      this.addToHistory(
        "observe",
        {
          instruction: effective.instruction,
          domSettleTimeoutMs: effective.domSettleTimeoutMs,
          returnAction: effective.returnAction,
          drawOverlay: effective.drawOverlay,
        },
        results,
      );
      return results;
    });
  }

  /** Return the browser-level CDP WebSocket endpoint. */
  connectURL(): string {
    if (this.state.kind === "UNINITIALIZED") {
      throw new Error("V3 not initialized. Call await v3.init() first.");
    }
    return this.state.ws;
  }

  /** Expose the current CDP-backed context. */
  public get context(): V3Context {
    return this.ctx;
  }

  /** Best-effort cleanup of context and launched resources. */
  async close(opts?: { force?: boolean }): Promise<void> {
    // If we're already closing and this isn't a forced close, no-op.
    if (this._isClosing && !opts?.force) return;
    this._isClosing = true;

    try {
      // Unhook CDP transport close handler if context exists
      try {
        if (this.ctx?.conn && this._onCdpClosed) {
          this.ctx.conn.offTransportClosed?.(this._onCdpClosed);
        }
      } catch {
        //
      }

      // Best-effort CDP/Context close
      try {
        await this.ctx?.close();
      } catch {
        //
      }

      // Kill local Chrome if present
      if (this.state.kind === "LOCAL") {
        try {
          await this.state.chrome.kill();
        } catch {
          //
        }
      }
    } finally {
      // Reset internal state
      this.state = { kind: "UNINITIALIZED" };
      this.ctx = null;
      this._isClosing = false;
      try {
        unbindInstanceLogger(this.instanceId);
      } catch {
        // ignore
      }
      // Remove from global registry
      V3._instances.delete(this);
    }
  }

  /** Guard: ensure Browserbase credentials exist in options. */
  private requireBrowserbaseCreds(): { apiKey: string; projectId: string } {
    let { apiKey, projectId } = this.opts;

    // Fall back to environment variables if not explicitly provided
    // dotenv is already configured at the top of this module
    if (!apiKey)
      apiKey = process.env.BROWSERBASE_API_KEY ?? process.env.BB_API_KEY;
    if (!projectId)
      projectId =
        process.env.BROWSERBASE_PROJECT_ID ?? process.env.BB_PROJECT_ID;

    if (!apiKey || !projectId) {
      const missing: string[] = [];
      if (!apiKey) missing.push("BROWSERBASE_API_KEY");
      if (!projectId) missing.push("BROWSERBASE_PROJECT_ID");
      throw new Error(
        `BROWSERBASE credentials missing. Provide in your v3 constructor, or set ${missing.join(
          ", ",
        )} in your .env`,
      );
    }

    // Cache resolved values back into opts for consistency
    this.opts.apiKey = apiKey;
    this.opts.projectId = projectId;

    // Informational log
    this.logger({
      category: "init",
      message: "Using Browserbase credentials",
      level: 1,
    });

    return { apiKey, projectId };
  }

  public get logger(): (logLine: LogLine) => void {
    return (logLine: LogLine) => {
      const fn = this.externalLogger;
      const line = { ...logLine, level: logLine.level ?? 1 };
      if (typeof fn === "function") {
        try {
          fn(line);
          return;
        } catch {
          // fall through to no-op
        }
      }
      // Fallback to global v3 logger so console/Pino still receive logs
      v3Logger(line);
    };
  }

  /**
   * Normalize a Playwright/Puppeteer page object into its top frame id,
   * so handlers can resolve it to a `Page` within our V3Context.
   */
  private async resolveTopFrameId(
    page: PlaywrightPage | PuppeteerPage,
  ): Promise<string> {
    if (this.isPlaywrightPage(page)) {
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      return frameTree.frame.id;
    }

    if (this.isPuppeteerPage(page)) {
      const cdp = await page.target().createCDPSession();
      const { frameTree } = await cdp.send("Page.getFrameTree");
      this.logger({
        category: "v3",
        message: "Puppeteer frame id",
        level: 2,
        auxiliary: { frameId: { value: frameTree.frame.id, type: "string" } },
      });
      return frameTree.frame.id;
    }

    throw new Error("Unsupported page object passed to V3.act()");
  }

  private isPlaywrightPage(p: unknown): p is PlaywrightPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PlaywrightPage).context === "function"
    );
  }

  private isPuppeteerPage(p: unknown): p is PuppeteerPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PuppeteerPage).target === "function"
    );
  }

  private async normalizeToV3Page(input: AnyPage): Promise<Page> {
    if (input instanceof (await import("./understudy/page")).Page) {
      return input as Page;
    }
    if (this.isPlaywrightPage(input)) {
      const frameId = await this.resolveTopFrameId(input);
      const page = this.ctx!.resolvePageByMainFrameId(frameId);
      if (!page)
        throw new Error("Failed to resolve V3 Page from Playwright page.");
      return page;
    }
    if (this.isPuppeteerPage(input)) {
      const frameId = await this.resolveTopFrameId(input);
      const page = this.ctx!.resolvePageByMainFrameId(frameId);
      if (!page)
        throw new Error("Failed to resolve V3 Page from Puppeteer page.");
      return page;
    }
    throw new Error("Unsupported page object.");
  }

  /**
   * Create a v3 agent instance (AISDK tool-based) with execute().
   * Mirrors the v2 Stagehand.agent() tool mode (no CUA provider here).
   */
  agent(options?: AgentConfig): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentResult>;
  } {
    this.logger({
      category: "agent",
      message: "Creating v3 agent instance",
      level: 1,
    });

    // If a CUA provider is specified, use the CUA path
    if (options?.provider) {
      return {
        execute: async (instructionOrOptions: string | AgentExecuteOptions) =>
          withInstanceLogContext(this.instanceId, async () => {
            if (options?.integrations && !this.experimental) {
              throw new Error(
                "MCP integrations are experimental. Enable experimental: true in V3 options.",
              );
            }
            const tools = options?.integrations
              ? await resolveTools(options.integrations, options.tools)
              : (options?.tools ?? {});

            const handler = new V3CuaAgentHandler(
              this,
              this.logger,
              {
                modelName: options.model!,
                clientOptions: options.options,
                userProvidedInstructions:
                  options.instructions ??
                  `You are a helpful assistant that can use a web browser.\nDo not ask follow up questions, the user will trust your judgement.`,
                agentType: options.provider,
              },
              tools,
            );
            return handler.execute(instructionOrOptions);
          }),
      };
    }

    // Default: AISDK tools-based agent
    return {
      execute: async (instructionOrOptions: string | AgentExecuteOptions) =>
        withInstanceLogContext(this.instanceId, async () => {
          if (options?.integrations && !this.experimental) {
            throw new Error(
              "MCP integrations are experimental. Enable experimental: true in V3 options.",
            );
          }

          const tools = options?.integrations
            ? await resolveTools(options.integrations, options.tools)
            : (options?.tools ?? {});

          const handler = new V3AgentHandler(
            this,
            this.logger,
            this.llmClient,
            options?.model,
            options?.instructions,
            tools,
          );
          return handler.execute(instructionOrOptions);
        }),
    };
  }
}

function isObserveResult(v: unknown): v is ObserveResult {
  return (
    !!v && typeof v === "object" && "selector" in (v as Record<string, unknown>)
  );
}
