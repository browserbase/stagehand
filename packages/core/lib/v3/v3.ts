import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import type { ZodTypeAny } from "zod/v3";
import { z } from "zod/v3";
import { loadApiKeyFromEnv } from "../utils";
import { ActCache } from "./cache/ActCache";
import { AgentCache } from "./cache/AgentCache";
import { CacheStorage } from "./cache/CacheStorage";
import { ActHandler } from "./handlers/actHandler";
import { ExtractHandler } from "./handlers/extractHandler";
import { ObserveHandler } from "./handlers/observeHandler";
import { V3AgentHandler } from "./handlers/v3AgentHandler";
import { V3CuaAgentHandler } from "./handlers/v3CuaAgentHandler";
import { createBrowserbaseSession } from "./launch/browserbase";
import { launchLocalChrome } from "./launch/local";
import { LLMClient } from "./llm/LLMClient";
import { LLMProvider } from "./llm/LLMProvider";
import {
  bindInstanceLogger,
  initV3Logger,
  unbindInstanceLogger,
  v3Logger,
  withInstanceLogContext,
} from "./logger";
import { resolveTools } from "./mcp/utils";
import {
  ActHandlerParams,
  ExtractHandlerParams,
  ObserveHandlerParams,
  AgentReplayStep,
  InitState,
  AgentCacheContext,
} from "./types/private";
import {
  AgentConfig,
  AgentExecuteOptions,
  AgentResult,
  AVAILABLE_CUA_MODELS,
  LogLine,
  V3Metrics,
  Action,
  ActOptions,
  ActResult,
  defaultExtractSchema,
  ExtractOptions,
  HistoryEntry,
  ObserveOptions,
  pageTextSchema,
  V3FunctionName,
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
  LocalBrowserLaunchOptions,
  V3Options,
  AnyPage,
  PatchrightPage,
  PlaywrightPage,
  PuppeteerPage,
} from "./types/public";
import { V3Context } from "./understudy/context";
import { Page } from "./understudy/page";
import { resolveModel } from "../modelUtils";

const DEFAULT_MODEL_NAME = "openai/gpt-4.1-mini";
const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

type ResolvedModelConfiguration = {
  modelName: AvailableModel;
  clientOptions?: ClientOptions;
};

function resolveModelConfiguration(
  model?: V3Options["model"],
): ResolvedModelConfiguration {
  if (!model) {
    return { modelName: DEFAULT_MODEL_NAME };
  }

  if (typeof model === "string") {
    return { modelName: model as AvailableModel };
  }

  if (model && typeof model === "object") {
    const { modelName, ...clientOptions } = model;
    if (!modelName) {
      throw new Error(
        "model.modelName is required when providing client options.",
      );
    }
    return {
      modelName,
      clientOptions: clientOptions as ClientOptions,
    };
  }

  return { modelName: DEFAULT_MODEL_NAME };
}
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
  private overrideLlmClients: Map<string, LLMClient> = new Map();
  private readonly domSettleTimeoutMs?: number;
  private _isClosing = false;
  public browserbaseSessionId?: string;
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
  private cacheStorage: CacheStorage;
  private actCache: ActCache;
  private agentCache: AgentCache;

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

  private resolveLlmClient(model?: ModelConfiguration): LLMClient {
    if (!model) {
      return this.llmClient;
    }

    let modelName: AvailableModel | string;
    let clientOptions: ClientOptions | undefined;

    if (typeof model === "string") {
      modelName = model;
    } else {
      const { modelName: overrideModelName, ...rest } = model;
      modelName = overrideModelName;
      clientOptions = rest as ClientOptions;
    }

    if (
      modelName === this.modelName &&
      (!clientOptions || Object.keys(clientOptions).length === 0)
    ) {
      return this.llmClient;
    }

    const overrideProvider = String(modelName).split("/")[0];
    const baseProvider = String(this.modelName).split("/")[0];

    const mergedOptions = {
      ...(overrideProvider === baseProvider ? this.modelClientOptions : {}),
      ...(clientOptions ?? {}),
    } as ClientOptions;

    const providerKey = overrideProvider;
    if (!(mergedOptions as { apiKey?: string }).apiKey) {
      const apiKey = loadApiKeyFromEnv(providerKey, this.logger);
      if (apiKey) {
        (mergedOptions as { apiKey?: string }).apiKey = apiKey;
      }
    }

    const cacheKey = JSON.stringify({
      modelName,
      clientOptions: mergedOptions,
    });

    const cached = this.overrideLlmClients.get(cacheKey);
    if (cached) {
      return cached;
    }

    const client = this.llmProvider.getClient(
      modelName as AvailableModel,
      mergedOptions,
    );

    this.overrideLlmClients.set(cacheKey, client);
    return client;
  }

  private beginAgentReplayRecording(): void {
    this.agentCache.beginRecording();
  }

  private endAgentReplayRecording(): AgentReplayStep[] {
    return this.agentCache.endRecording();
  }

  private discardAgentReplayRecording(): void {
    this.agentCache.discardRecording();
  }

  private isAgentReplayRecording(): boolean {
    return this.agentCache.isRecording();
  }

  public isAgentReplayActive(): boolean {
    return this.agentCache.isReplayActive();
  }

  public recordAgentReplayStep(step: AgentReplayStep): void {
    this.agentCache.recordStep(step);
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
    const { modelName, clientOptions } = resolveModelConfiguration(opts.model);
    this.modelName = modelName;
    this.experimental = opts.experimental ?? false;
    this.logInferenceToFile = opts.logInferenceToFile ?? false;
    this.llmProvider = new LLMProvider(this.logger);
    this.domSettleTimeoutMs = opts.domSettleTimeout;
    const baseClientOptions: ClientOptions = clientOptions
      ? ({ ...clientOptions } as ClientOptions)
      : ({} as ClientOptions);
    if (opts.llmClient) {
      this.llmClient = opts.llmClient;
      this.modelClientOptions = baseClientOptions;
    } else {
      // Ensure API key is set
      let apiKey = (baseClientOptions as { apiKey?: string }).apiKey;
      if (!apiKey) {
        apiKey = loadApiKeyFromEnv(
          this.modelName.split("/")[0], // "openai", "anthropic", etc
          this.logger,
        );
      }
      this.modelClientOptions = {
        ...baseClientOptions,
        apiKey,
      } as ClientOptions;

      // Get the default client for this model
      this.llmClient = this.llmProvider.getClient(
        this.modelName,
        this.modelClientOptions,
      );
    }

    this.cacheStorage = CacheStorage.create(opts.cacheDir, this.logger, {
      label: "cache directory",
    });
    this.actCache = new ActCache({
      storage: this.cacheStorage,
      logger: this.logger,
      getActHandler: () => this.actHandler,
      getDefaultLlmClient: () => this.resolveLlmClient(),
      domSettleTimeoutMs: this.domSettleTimeoutMs,
    });
    this.agentCache = new AgentCache({
      storage: this.cacheStorage,
      logger: this.logger,
      getActHandler: () => this.actHandler,
      getContext: () => this.ctx,
      getDefaultLlmClient: () => this.resolveLlmClient(),
      getBaseModelName: () => this.modelName,
      getSystemPrompt: () => opts.systemPrompt,
      domSettleTimeoutMs: this.domSettleTimeoutMs,
      act: this.act.bind(this),
    });

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
        (model) => this.resolveLlmClient(model),
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
        this.domSettleTimeoutMs,
      );
      this.extractHandler = new ExtractHandler(
        this.llmClient,
        this.modelName,
        this.modelClientOptions,
        (model) => this.resolveLlmClient(model),
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
        (model) => this.resolveLlmClient(model),
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
        const lbo: LocalBrowserLaunchOptions =
          this.opts.localBrowserLaunchOptions ?? {};

        // If a CDP URL is provided, attach instead of launching.
        if (lbo.cdpUrl) {
          this.ctx = await V3Context.create(lbo.cdpUrl, {
            env: "LOCAL",
          });
          this.ctx.conn.onTransportClosed(this._onCdpClosed);
          this.state = {
            kind: "LOCAL",
            // no LaunchedChrome when attaching externally; create a stub kill
            chrome: {
              kill: async () => {},
            } as unknown as import("chrome-launcher").LaunchedChrome,
            ws: lbo.cdpUrl,
          };
          // Post-connect settings (downloads and viewport) if provided
          await this._applyPostConnectLocalOptions(lbo);
          return;
        }

        // Determine or create user data dir
        let userDataDir = lbo.userDataDir;
        let createdTemp = false;
        if (!userDataDir) {
          const base = path.join(os.tmpdir(), "stagehand-v3");
          fs.mkdirSync(base, { recursive: true });
          userDataDir = fs.mkdtempSync(path.join(base, "profile-"));
          createdTemp = true;
        }

        // Build chrome flags
        const defaults = [
          "--remote-allow-origins=*",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          "--site-per-process",
        ];
        let chromeFlags: string[] = [];
        const ignore = lbo.ignoreDefaultArgs;
        if (ignore === true) {
          // drop defaults
          chromeFlags = [];
        } else if (Array.isArray(ignore)) {
          chromeFlags = defaults.filter(
            (f) => !ignore.some((ex) => f.includes(ex)),
          );
        } else {
          chromeFlags = [...defaults];
        }

        // headless handled by launchLocalChrome
        if (lbo.devtools) chromeFlags.push("--auto-open-devtools-for-tabs");
        if (lbo.locale) chromeFlags.push(`--lang=${lbo.locale}`);
        if (!lbo.viewport) {
          lbo.viewport = DEFAULT_VIEWPORT;
        }
        if (lbo.viewport?.width && lbo.viewport?.height) {
          chromeFlags.push(
            `--window-size=${lbo.viewport.width},${lbo.viewport.height + 87}`, // Added pixels to the window to account for the address bar
          );
        }
        if (typeof lbo.deviceScaleFactor === "number") {
          chromeFlags.push(
            `--force-device-scale-factor=${Math.max(0.1, lbo.deviceScaleFactor)}`,
          );
        }
        if (lbo.hasTouch) chromeFlags.push("--touch-events=enabled");
        if (lbo.ignoreHTTPSErrors)
          chromeFlags.push("--ignore-certificate-errors");
        if (lbo.proxy?.server)
          chromeFlags.push(`--proxy-server=${lbo.proxy.server}`);
        if (lbo.proxy?.bypass)
          chromeFlags.push(`--proxy-bypass-list=${lbo.proxy.bypass}`);

        // add user-supplied args last
        if (Array.isArray(lbo.args)) chromeFlags.push(...lbo.args);

        const { ws, chrome } = await launchLocalChrome({
          chromePath: lbo.executablePath,
          chromeFlags,
          headless: lbo.headless,
          userDataDir,
          connectTimeoutMs: lbo.connectTimeoutMs,
        });
        this.ctx = await V3Context.create(ws, {
          env: "LOCAL",
          localBrowserLaunchOptions: lbo,
        });
        this.ctx.conn.onTransportClosed(this._onCdpClosed);
        this.state = {
          kind: "LOCAL",
          chrome,
          ws,
          userDataDir,
          createdTempProfile: createdTemp,
          preserveUserDataDir: !!lbo.preserveUserDataDir,
        };
        this.browserbaseSessionId = undefined;

        // Post-connect settings (downloads and viewport) if provided
        await this._applyPostConnectLocalOptions(lbo);
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
          env: "BROWSERBASE",
        });
        this.ctx.conn.onTransportClosed(this._onCdpClosed);
        this.state = { kind: "BROWSERBASE", sessionId, ws, bb };
        this.browserbaseSessionId = sessionId;

        await this._ensureBrowserbaseDownloadsEnabled();

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

  /** Apply post-connect local browser options that require CDP. */
  private async _applyPostConnectLocalOptions(
    lbo: LocalBrowserLaunchOptions,
  ): Promise<void> {
    try {
      // Downloads behavior
      if (lbo.downloadsPath || lbo.acceptDownloads !== undefined) {
        const behavior = lbo.acceptDownloads === false ? "deny" : "allow";
        await this.ctx?.conn
          .send("Browser.setDownloadBehavior", {
            behavior,
            downloadPath: lbo.downloadsPath,
            eventsEnabled: true,
          })
          .catch(() => {});
      }

      // Viewport
      if (lbo.viewport) {
        const page = await this.ctx!.awaitActivePage();
        await page
          .setViewportSize(lbo.viewport.width, lbo.viewport.height, {
            deviceScaleFactor: lbo.deviceScaleFactor ?? 1,
          })
          .catch(() => {});
      }
    } catch {
      // best-effort only
    }
  }

  private async _ensureBrowserbaseDownloadsEnabled(): Promise<void> {
    const conn = this.ctx?.conn;
    if (!conn) return;
    try {
      await conn.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: "downloads",
        eventsEnabled: true,
      });
    } catch {
      // best-effort only
    }
  }

  /**
   * Run an "act" instruction through the ActHandler.
   *
   * New API:
   * - act(instruction: string, options?: ActOptions)
   * - act(action: Action, options?: ActOptions)
   */
  async act(instruction: string, options?: ActOptions): Promise<ActResult>;
  async act(action: Action, options?: ActOptions): Promise<ActResult>;

  async act(input: string | Action, options?: ActOptions): Promise<ActResult> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.actHandler)
        throw new Error("V3 not initialized. Call init() before act().");

      if (isObserveResult(input)) {
        // Resolve page: use provided page if any, otherwise default active page
        const v3Page = await this.resolvePage(options?.page);

        // Use selector as provided to support XPath, CSS, and other engines
        const selector = input.selector;
        const actResult = await this.actHandler.actFromObserveResult(
          { ...input, selector }, // ObserveResult
          v3Page, // V3 Page
          this.domSettleTimeoutMs,
          this.resolveLlmClient(options?.model),
        );
        // history: record ObserveResult-based act call
        this.addToHistory(
          "act",
          {
            observeResult: input,
          },
          actResult,
        );
        return actResult;
      }
      // instruction path
      if (typeof input !== "string" || !input.trim()) {
        throw new Error(
          "act(): instruction string is required unless passing an Action",
        );
      }

      // Resolve page from options or default
      const page = await this.resolvePage(options?.page);

      let actCacheContext: Awaited<
        ReturnType<typeof this.actCache.prepareContext>
      > | null = null;
      const canUseCache =
        typeof input === "string" &&
        !this.isAgentReplayRecording() &&
        this.actCache.enabled;
      if (canUseCache) {
        actCacheContext = await this.actCache.prepareContext(
          input,
          page,
          options?.variables,
        );
        if (actCacheContext) {
          const cachedResult = await this.actCache.tryReplay(
            actCacheContext,
            page,
            options?.timeout,
          );
          if (cachedResult) {
            this.addToHistory(
              "act",
              {
                instruction: input,
                variables: options?.variables,
                timeout: options?.timeout,
                cacheHit: true,
              },
              cachedResult,
            );
            return cachedResult;
          }
        }
      }

      const handlerParams: ActHandlerParams = {
        instruction: input,
        page,
        variables: options?.variables,
        timeout: options?.timeout,
        model: options?.model,
      };
      const actResult = await this.actHandler.act(handlerParams);
      // history: record instruction-based act call (omit page object)
      this.addToHistory(
        "act",
        {
          instruction: input,
          variables: options?.variables,
          timeout: options?.timeout,
        },
        actResult,
      );

      if (
        actCacheContext &&
        actResult.success &&
        Array.isArray(actResult.actions) &&
        actResult.actions.length > 0
      ) {
        await this.actCache.store(actCacheContext, actResult);
      }
      return actResult;
    });
  }

  /**
   * Run an "extract" instruction through the ExtractHandler.
   *
   * Accepted forms:
   * - extract() → pageText
   * - extract(options) → pageText
   * - extract(instruction) → defaultExtractSchema
   * - extract(instruction, schema) → schema-inferred
   * - extract(instruction, schema, options)
   */

  async extract(): Promise<z.infer<typeof pageTextSchema>>;
  async extract(
    options: ExtractOptions,
  ): Promise<z.infer<typeof pageTextSchema>>;
  async extract(
    instruction: string,
    options?: ExtractOptions,
  ): Promise<z.infer<typeof defaultExtractSchema>>;
  async extract<T extends ZodTypeAny>(
    instruction: string,
    schema: T,
    options?: ExtractOptions,
  ): Promise<z.infer<T>>;

  async extract(
    a?: string | ExtractOptions,
    b?: ZodTypeAny | ExtractOptions,
    c?: ExtractOptions,
  ): Promise<unknown> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.extractHandler) {
        throw new Error("V3 not initialized. Call init() before extract().");
      }

      // Normalize args
      let instruction: string | undefined;
      let schema: ZodTypeAny | undefined;
      let options: ExtractOptions | undefined;

      if (typeof a === "string") {
        instruction = a;
        const isZodSchema = (val: unknown): val is ZodTypeAny =>
          !!val &&
          typeof val === "object" &&
          "parse" in val &&
          "safeParse" in val;
        if (isZodSchema(b)) {
          schema = b as ZodTypeAny;
          options = c as ExtractOptions | undefined;
        } else {
          options = b as ExtractOptions | undefined;
        }
      } else {
        // a is options or undefined
        options = (a as ExtractOptions) || undefined;
      }

      if (!instruction && schema) {
        throw new Error("extract(): schema provided without instruction");
      }

      // If instruction without schema → defaultExtractSchema
      const effectiveSchema =
        instruction && !schema ? defaultExtractSchema : schema;

      // Resolve page from options or use active page
      const page = await this.resolvePage(options?.page);

      const handlerParams: ExtractHandlerParams<ZodTypeAny> = {
        instruction,
        schema: effectiveSchema as unknown as ZodTypeAny | undefined,
        model: options?.model,
        timeout: options?.timeout,
        selector: options?.selector,
        page,
      };

      const result =
        await this.extractHandler.extract<ZodTypeAny>(handlerParams);

      // history: record extract call (omit page object and raw schema instance)
      this.addToHistory(
        "extract",
        {
          instruction,
          hasSchema: Boolean(effectiveSchema),
          timeout: options?.timeout,
          selector: options?.selector,
        },
        result,
      );
      return result;
    });
  }

  /**
   * Run an "observe" instruction through the ObserveHandler.
   */
  async observe(): Promise<Action[]>;
  async observe(options: ObserveOptions): Promise<Action[]>;
  async observe(
    instruction: string,
    options?: ObserveOptions,
  ): Promise<Action[]>;
  async observe(
    a?: string | ObserveOptions,
    b?: ObserveOptions,
  ): Promise<Action[]> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.observeHandler) {
        throw new Error("V3 not initialized. Call init() before observe().");
      }

      // Normalize args
      let instruction: string | undefined;
      let options: ObserveOptions | undefined;
      if (typeof a === "string") {
        instruction = a;
        options = b;
      } else {
        options = a as ObserveOptions | undefined;
      }

      // Resolve to our internal Page type
      const page = await this.resolvePage(options?.page);

      const handlerParams: ObserveHandlerParams = {
        instruction,
        model: options?.model,
        timeout: options?.timeout,
        selector: options?.selector,
        page,
      };

      const results = await this.observeHandler.observe(handlerParams);
      // history: record observe call (omit page object)
      this.addToHistory(
        "observe",
        {
          instruction,
          timeout: options?.timeout,
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
        // cleanup temp user data dir if we created it and not preserved
        try {
          if (
            this.state.createdTempProfile &&
            !this.state.preserveUserDataDir &&
            this.state.userDataDir
          ) {
            fs.rmSync(this.state.userDataDir, { recursive: true, force: true });
          }
        } catch {
          // ignore cleanup errors
        }
      }
    } finally {
      // Reset internal state
      this.state = { kind: "UNINITIALIZED" };
      this.ctx = null;
      this._isClosing = false;
      this.browserbaseSessionId = undefined;
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
    page: PlaywrightPage | PuppeteerPage | PatchrightPage,
  ): Promise<string> {
    if (this.isPlaywrightPage(page)) {
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      return frameTree.frame.id;
    }

    if (this.isPatchrightPage(page)) {
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

  private isPatchrightPage(p: unknown): p is PatchrightPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PatchrightPage).context === "function"
    );
  }

  private isPuppeteerPage(p: unknown): p is PuppeteerPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PuppeteerPage).target === "function"
    );
  }

  /** Resolve an external page reference or fall back to the active V3 page. */
  private async resolvePage(page?: AnyPage): Promise<Page> {
    if (page) {
      return await this.normalizeToV3Page(page);
    }
    const ctx = this.ctx;
    if (!ctx) {
      throw new Error(
        "V3 context not initialized. Call init() before resolving pages.",
      );
    }
    return await ctx.awaitActivePage();
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
    if (this.isPatchrightPage(input)) {
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

    // If CUA is enabled, use the computer-use agent path
    if (options?.cua) {
      const modelToUse = options?.model || {
        modelName: this.modelName,
        ...this.modelClientOptions,
      };

      const { modelName, isCua, clientOptions } = resolveModel(modelToUse);

      if (!isCua) {
        throw new Error(
          "To use the computer use agent, please provide a CUA model in the agent constructor or stagehand config. Try one of our supported CUA models: " +
            AVAILABLE_CUA_MODELS.join(", "),
        );
      }

      const agentConfigSignature =
        this.agentCache.buildConfigSignature(options);
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
                modelName,
                clientOptions,
                userProvidedInstructions:
                  options.systemPrompt ??
                  `You are a helpful assistant that can use a web browser.\nDo not ask follow up questions, the user will trust your judgement.`,
              },
              tools,
            );

            const resolvedOptions: AgentExecuteOptions =
              typeof instructionOrOptions === "string"
                ? { instruction: instructionOrOptions }
                : instructionOrOptions;
            if (resolvedOptions.page) {
              const normalizedPage = await this.normalizeToV3Page(
                resolvedOptions.page,
              );
              this.ctx!.setActivePage(normalizedPage);
            }
            const instruction = resolvedOptions.instruction.trim();
            const sanitizedOptions =
              this.agentCache.sanitizeExecuteOptions(resolvedOptions);

            let cacheContext: AgentCacheContext | null = null;
            if (this.agentCache.shouldAttemptCache(instruction)) {
              const startPage = await this.ctx!.awaitActivePage();
              cacheContext = await this.agentCache.prepareContext({
                instruction,
                options: sanitizedOptions,
                configSignature: agentConfigSignature,
                page: startPage,
              });
              if (cacheContext) {
                const replayed = await this.agentCache.tryReplay(cacheContext);
                if (replayed) {
                  return replayed;
                }
              }
            }

            let agentSteps: AgentReplayStep[] = [];
            const recording = !!cacheContext;
            if (recording) {
              this.beginAgentReplayRecording();
            }

            try {
              const result = await handler.execute(instructionOrOptions);
              if (recording) {
                agentSteps = this.endAgentReplayRecording();
              }

              if (cacheContext && result.success && agentSteps.length > 0) {
                await this.agentCache.store(cacheContext, agentSteps, result);
              }

              return result;
            } catch (err) {
              if (recording) this.discardAgentReplayRecording();
              throw err;
            } finally {
              if (recording) {
                this.discardAgentReplayRecording();
              }
            }
          }),
      };
    }

    // Default: AISDK tools-based agent
    const agentConfigSignature = this.agentCache.buildConfigSignature(options);

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

          // Resolve the LLM client for the agent based on the model parameter
          // Use the agent's model if specified, otherwise fall back to the default
          const agentLlmClient = options?.model
            ? this.resolveLlmClient(options.model)
            : this.llmClient;

          const handler = new V3AgentHandler(
            this,
            this.logger,
            agentLlmClient,
            typeof options?.executionModel === "string"
              ? options.executionModel
              : options?.executionModel?.modelName,
            options?.systemPrompt,
            tools,
          );

          const resolvedOptions: AgentExecuteOptions =
            typeof instructionOrOptions === "string"
              ? { instruction: instructionOrOptions }
              : instructionOrOptions;
          if (resolvedOptions.page) {
            const normalizedPage = await this.normalizeToV3Page(
              resolvedOptions.page,
            );
            this.ctx!.setActivePage(normalizedPage);
          }
          const instruction = resolvedOptions.instruction.trim();
          const sanitizedOptions =
            this.agentCache.sanitizeExecuteOptions(resolvedOptions);

          let cacheContext: AgentCacheContext | null = null;
          if (this.agentCache.shouldAttemptCache(instruction)) {
            const startPage = await this.ctx!.awaitActivePage();
            cacheContext = await this.agentCache.prepareContext({
              instruction,
              options: sanitizedOptions,
              configSignature: agentConfigSignature,
              page: startPage,
            });
            if (cacheContext) {
              const replayed = await this.agentCache.tryReplay(cacheContext);
              if (replayed) {
                return replayed;
              }
            }
          }

          let agentSteps: AgentReplayStep[] = [];
          const recording = !!cacheContext;
          if (recording) {
            this.beginAgentReplayRecording();
          }

          try {
            const result = await handler.execute(instructionOrOptions);
            if (recording) {
              agentSteps = this.endAgentReplayRecording();
            }

            if (cacheContext && result.success && agentSteps.length > 0) {
              await this.agentCache.store(cacheContext, agentSteps, result);
            }

            return result;
          } catch (err) {
            if (recording) this.discardAgentReplayRecording();
            throw err;
          } finally {
            if (recording) {
              this.discardAgentReplayRecording();
            }
          }
        }),
    };
  }
}

function isObserveResult(v: unknown): v is Action {
  return (
    !!v && typeof v === "object" && "selector" in (v as Record<string, unknown>)
  );
}
