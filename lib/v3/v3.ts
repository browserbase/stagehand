import { launch, LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import {
  V3Options,
  InitState,
  BrowserbaseSession,
  JsonVersionResponse,
  PlaywrightPage,
  PuppeteerPage,
  ActParams,
  ActHandlerParams,
  ExtractHandlerParams,
  ExtractParams,
  ObserveParams,
  ObserveHandlerParams,
  AnyPage,
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
import { defaultExtractSchema } from "@/types/page";
import { ObserveResult } from "@/types/stagehand";
import { StagehandLogger } from "@/lib/logger";
import { LogLine } from "@/types/log";

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
  public readonly experimental: boolean = false;
  public readonly logInferenceToFile: boolean = false;

  private stagehandLogger: StagehandLogger;
  private externalLogger?: (logLine: LogLine) => void;
  public verbose: 0 | 1 | 2 = 1;

  constructor(opts: V3Options) {
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
    );
    this.extractHandler = new ExtractHandler(
      this.llmClient,
      this.modelName,
      this.modelClientOptions,
      this.logger,
      this.opts.systemPrompt ?? "",
      this.logInferenceToFile,
      this.experimental,
    );
    this.observeHandler = new ObserveHandler(
      this.llmClient,
      this.modelName,
      this.modelClientOptions,
      this.logger,
      this.opts.systemPrompt ?? "",
      this.logInferenceToFile,
      this.experimental,
    );
    if (this.opts.env === "LOCAL") {
      const { ws, chrome } = await this.initLocal();
      this.state = { kind: "LOCAL", chrome, ws };
      return;
    }

    if (this.opts.env === "BROWSERBASE") {
      const { apiKey, projectId } = this.requireBrowserbaseCreds();
      const { ws, sessionId, bb } = await this.initBrowserbase(
        apiKey,
        projectId,
      );
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
  async act(params: ActParams): Promise<void>;
  async act(
    observe: ObserveResult,
    page: AnyPage,
    opts?: { domSettleTimeoutMs?: number; timeoutMs?: number },
  ): Promise<void>;

  async act(
    a: ActParams | ObserveResult,
    b?: AnyPage,
    c?: { domSettleTimeoutMs?: number; timeoutMs?: number },
  ): Promise<void> {
    if (!this.actHandler)
      throw new Error("V3 not initialized. Call init() before act().");

    if (isObserveResult(a) && b) {
      const v3Page = await this.normalizeToV3Page(b);
      // normalize selector to the engine your executor expects
      const selector = a.selector.startsWith("xpath=")
        ? a.selector
        : `xpath=${a.selector}`;
      await this.actHandler.actFromObserveResult(
        { ...a, selector }, // ObserveResult
        v3Page, // V3 Page
        c?.domSettleTimeoutMs,
      );
      return;
    }
    const params = a as ActParams;

    let page: Page | undefined;

    if (params.page) {
      if (params.page instanceof (await import("./understudy/page")).Page) {
        // Already a V3 Page
        page = params.page;
      } else {
        // Playwright / Puppeteer path: resolve → frameId → V3 Page
        const frameId = await this.resolveTopFrameId(params.page);
        page = this.ctx!.resolvePageByMainFrameId(frameId);
      }
    }

    const handlerParams: ActHandlerParams = {
      instruction: params.instruction,
      page: page!,
    };
    return this.actHandler.act(handlerParams);
  }

  /**
   * Run an "extract" instruction through the ExtractHandler.
   */

  async extract<T extends z.AnyZodObject>(
    params: ExtractParams<T>,
  ): Promise<z.infer<T> | { page_text: string }> {
    if (!this.extractHandler) {
      throw new Error("V3 not initialized. Call init() before extract().");
    }

    let page: Page | undefined;

    if (params.page) {
      if (params.page instanceof (await import("./understudy/page")).Page) {
        // Already a V3 Page
        page = params.page;
      } else {
        // Playwright / Puppeteer path: resolve → frameId → V3 Page
        const frameId = await this.resolveTopFrameId(params.page);
        page = this.ctx.resolvePageByMainFrameId(frameId);
      }
    }

    const noArgs = !params.instruction && !params.schema;
    const onlyInstruction = !!params.instruction && !params.schema;

    const effectiveSchema: T | undefined = noArgs
      ? undefined
      : onlyInstruction
        ? (defaultExtractSchema as unknown as T)
        : params.schema;

    const handlerParams: ExtractHandlerParams<T> = {
      instruction: params.instruction,
      schema: effectiveSchema,
      modelName: params.modelName,
      modelClientOptions: params.modelClientOptions,
      domSettleTimeoutMs: params.domSettleTimeoutMs,
      page: page!,
    };

    return this.extractHandler.extract<T>(handlerParams);
  }

  /**
   * Run an "observe" instruction through the ObserveHandler.
   */
  async observe(params: ObserveParams): Promise<ObserveResult[]> {
    if (!this.observeHandler) {
      throw new Error("V3 not initialized. Call init() before observe().");
    }

    // Resolve to our internal Page type
    let page: Page | undefined;
    if (params.page) {
      if (params.page instanceof (await import("./understudy/page")).Page) {
        page = params.page;
      } else {
        const frameId = await this.resolveTopFrameId(params.page);
        page = this.ctx.resolvePageByMainFrameId(frameId);
      }
    }

    const handlerParams: ObserveHandlerParams = {
      instruction: params.instruction,
      domSettleTimeoutMs: params.domSettleTimeoutMs,
      returnAction: params.returnAction,
      drawOverlay: params.drawOverlay,
      fromAct: false,
      page: page!,
    };

    return this.observeHandler.observe(handlerParams);
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
  async close(): Promise<void> {
    await this.ctx?.close();
    if (this.state.kind === "LOCAL") {
      await this.state.chrome.kill();
    }
    this.state = { kind: "UNINITIALIZED" };
    this.ctx = null;
  }

  /**
   * Launch local Chrome with appropriate flags and return a CDP WebSocket.
   */
  private async initLocal(): Promise<{ ws: string; chrome: LaunchedChrome }> {
    const headless = this.opts.headless ?? true;
    const chromeFlags = [
      headless ? "--headless=new" : undefined,
      "--remote-allow-origins=*",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--site-per-process",
      this.opts.userDataDir
        ? `--user-data-dir=${this.opts.userDataDir}`
        : undefined,
      ...(this.opts.chromeFlags ?? []),
    ].filter((f): f is string => typeof f === "string");

    const chrome = await launch({
      chromePath: this.opts.chromePath,
      chromeFlags,
    });

    const ws = await this.waitForWebSocketDebuggerUrl(
      chrome.port,
      this.opts.connectTimeoutMs ?? 15_000,
    );
    this.ctx = await V3Context.create(ws);
    return { ws, chrome };
  }

  /** Guard: ensure Browserbase credentials exist in options. */
  private requireBrowserbaseCreds(): { apiKey: string; projectId: string } {
    const { apiKey, projectId } = this.opts;
    if (!apiKey || !projectId) {
      throw new Error(
        "BROWSERBASE requires both apiKey and projectId in V3Options.",
      );
    }
    return { apiKey, projectId };
  }

  public get logger(): (logLine: LogLine) => void {
    return (logLine: LogLine) => {
      logLine.level = logLine.level ?? 1;
      this.stagehandLogger.log(logLine);
    };
  }

  /**
   * Create a Browserbase session, return its WebSocket and session id.
   */
  private async initBrowserbase(
    apiKey: string,
    projectId: string,
  ): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
    const bb = new Browserbase({ apiKey });
    const session = (await bb.sessions.create({
      projectId,
    })) as BrowserbaseSession;

    if (!session?.connectUrl || !session?.id) {
      throw new Error(
        "Browserbase session creation returned an unexpected shape.",
      );
    }
    this.ctx = await V3Context.create(session.connectUrl);
    return { ws: session.connectUrl, sessionId: session.id, bb };
  }

  /**
   * Poll /json/version until Chrome returns a valid WebSocket endpoint.
   * Used only in local launch mode.
   */
  private async waitForWebSocketDebuggerUrl(
    port: number,
    timeoutMs: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastErrMsg = "";

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (resp.ok) {
          const json = (await resp.json()) as unknown;
          if (this.isJsonVersionResponse(json)) {
            return json.webSocketDebuggerUrl;
          }
        } else {
          lastErrMsg = `${resp.status} ${resp.statusText}`;
        }
      } catch (err) {
        lastErrMsg = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(
      `Timed out waiting for /json/version on port ${port}${
        lastErrMsg ? ` (last error: ${lastErrMsg})` : ""
      }`,
    );
  }

  /** Type guard for Chrome's /json/version response. */
  private isJsonVersionResponse(v: unknown): v is JsonVersionResponse {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl ===
        "string"
    );
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
