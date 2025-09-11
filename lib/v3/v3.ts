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
import { ObserveResult, ActResult, HistoryEntry } from "@/types/stagehand";
import { StagehandLogger } from "@/lib/logger";
import { LogLine } from "@/types/log";
import { launchLocalChrome } from "./launch/local";
import { createBrowserbaseSession } from "./launch/browserbase";
import process from "process";

const DEFAULT_MODEL_NAME = "openai/gpt-4.1-mini";
dotenv.config({ path: ".env" });

let globalLogger: StagehandLogger | null = null;

function defaultLogger(
  line: LogLine,
  disablePino?: boolean,
  verbose?: 0 | 1 | 2,
): void {
  if (!globalLogger) {
    globalLogger = new StagehandLogger(
      { pretty: true, usePino: !disablePino },
      undefined,
    );
    if (verbose !== undefined) globalLogger.setVerbosity(verbose); // << sync
  }
  globalLogger.log(line);
}

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
  private _processGuardsInstalled = false;
  private _onCdpClosed = (why: string) => {
    // Single place to react to the transport closing
    this._panicClose(`CDP transport closed: ${why}`).catch(() => {});
  };
  public readonly experimental: boolean = false;
  public readonly logInferenceToFile: boolean = false;

  private stagehandLogger: StagehandLogger;
  private externalLogger?: (logLine: LogLine) => void;
  public verbose: 0 | 1 | 2 = 1;
  private _history: Array<HistoryEntry> = [];

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

  public get metrics(): V3Metrics {
    return this.v3Metrics;
  }

  public get history(): ReadonlyArray<HistoryEntry> {
    return Object.freeze([...this._history]);
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
    this._installProcessGuards();
    this.externalLogger =
      (opts as { logger?: (l: LogLine) => void }).logger ??
      ((l: LogLine) =>
        defaultLogger(
          l,
          (opts as { disablePino?: boolean }).disablePino,
          (opts as { verbose?: 0 | 1 | 2 }).verbose ?? 1,
        ));

    this.stagehandLogger = new StagehandLogger(
      {
        pretty: true,
        usePino:
          !(opts as { disablePino?: boolean }).disablePino &&
          !(opts as { logger?: (l: LogLine) => void }).logger,
      },
      this.externalLogger,
    );
    this.verbose = (opts as { verbose?: 0 | 1 | 2 }).verbose ?? 1;
    this.stagehandLogger.setVerbosity(this.verbose);
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
  }

  private async _panicClose(reason: string): Promise<void> {
    try {
      // Optional: log to your logger if you prefer
      console.error(`[v3] panicClose → ${reason}`);
    } catch {
      //
    }

    try {
      console.error(`[v3] calling this.close() → ${reason}`);
      await this.close({ force: true });
    } catch {
      // swallow — we’re already panicking
    }
  }

  private _installProcessGuards(): void {
    if (this._processGuardsInstalled) return;
    this._processGuardsInstalled = true;

    const onSig = (sig: string) => {
      this._panicClose(`signal ${sig}`).finally(() => {
        // Let Node default exit continue; do NOT force process.exit here
      });
    };

    const exitAfter = async (label: string) => {
      try {
        // Give close() up to 3s; even if it times out, we still exit.
        await Promise.race([
          this.close({ force: true }),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } finally {
        console.error(`[v3] ${label}: exiting`);
        process.exit(1);
      }
    };

    const onUncaught = (err: unknown) => {
      console.error("[v3] uncaughtException:", err);
      void exitAfter("uncaughtException");
    };

    const onUnhandled = (reason: unknown) => {
      console.error("[v3] unhandledRejection:", reason);
      void exitAfter("unhandledRejection");
    };

    process.once("SIGINT", () => onSig("SIGINT"));
    process.once("SIGTERM", () => onSig("SIGTERM"));
    process.once("uncaughtException", onUncaught);
    process.once("unhandledRejection", onUnhandled);
  }

  /**
   * Entrypoint: initializes handlers, launches Chrome or Browserbase,
   * and sets up a CDP context.
   */
  async init(): Promise<void> {
    this.actHandler = new ActHandler(
      this.llmClient,
      this.modelName,
      this.modelClientOptions,
      this.logger,
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
      this.logger,
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
      this.logger,
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
      });
      this.ctx.conn.onTransportClosed(this._onCdpClosed);
      this.state = { kind: "BROWSERBASE", sessionId, ws, bb };
      return;
    }

    const neverEnv: never = this.opts.env;
    throw new Error(`Unsupported env: ${neverEnv}`);
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
        { observeResult: input, domSettleTimeoutMs: opts?.domSettleTimeoutMs },
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
  }

  /**
   * Run an "extract" instruction through the ExtractHandler.
   *
   * Overloads mirror StagehandPage.extract typing:
   * - No args → returns page text shape.
   * - String or options → defaults schema to defaultExtractSchema unless provided.
   */

  async extract(): Promise<z.infer<typeof pageTextSchema>>;
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
      if (effective.page instanceof (await import("./understudy/page")).Page) {
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
  }

  /** Return the browser-level CDP WebSocket endpoint. */
  connectURL(): string {
    if (this.state.kind === "UNINITIALIZED") {
      throw new Error("V3 not initialized. Call await v3.init() first.");
    }
    return this.state.ws;
  }

  /** Expose the current CDP-backed context. */
  context(): V3Context {
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
      logLine.level = logLine.level ?? 1;
      this.stagehandLogger.log(logLine);
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
      console.log("[ActHandler] Puppeteer frame id:", frameTree.frame.id);
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
}

function isObserveResult(v: unknown): v is ObserveResult {
  return (
    !!v && typeof v === "object" && "selector" in (v as Record<string, unknown>)
  );
}
