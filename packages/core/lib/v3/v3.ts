import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import { z } from "zod";
import type { InferStagehandSchema, StagehandZodSchema } from "./zodCompat";
import { loadApiKeyFromEnv } from "../utils";
import { StagehandLogger, LoggerOptions } from "../logger";
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
  StagehandMetrics,
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
  ExperimentalNotConfiguredError,
  CuaModelRequiredError,
  StagehandInvalidArgumentError,
  StagehandNotInitializedError,
  MissingEnvironmentVariableError,
  StagehandInitError,
  AgentStreamResult,
} from "./types/public";
import { V3Context } from "./understudy/context";
import { Page } from "./understudy/page";
import { resolveModel } from "../modelUtils";
import { StagehandAPIClient } from "./api";

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
      throw new StagehandInvalidArgumentError(
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
  private browserbaseSessionUrl?: string;
  private browserbaseDebugUrl?: string;
  public get browserbaseSessionID(): string | undefined {
    return this.browserbaseSessionId;
  }
  public get browserbaseSessionURL(): string | undefined {
    return this.browserbaseSessionUrl;
  }
  public get browserbaseDebugURL(): string | undefined {
    return this.browserbaseDebugUrl;
  }
  private _onCdpClosed = (why: string) => {
    if (this.state.kind === "BROWSERBASE") {
      void this._logBrowserbaseSessionStatus();
    }

    // Single place to react to the transport closing
    this._immediateShutdown(`CDP transport closed: ${why}`).catch(() => {});
  };
  public readonly experimental: boolean = false;
  public readonly logInferenceToFile: boolean = false;
  public readonly disableAPI: boolean = false;
  private externalLogger?: (logLine: LogLine) => void;
  public verbose: 0 | 1 | 2 = 1;
  private stagehandLogger: StagehandLogger;
  private _history: Array<HistoryEntry> = [];
  private readonly instanceId: string;
  private static _processGuardsInstalled = false;
  private static _instances: Set<V3> = new Set();
  private cacheStorage: CacheStorage;
  private actCache: ActCache;
  private agentCache: AgentCache;
  private apiClient: StagehandAPIClient | null = null;

  public stagehandMetrics: StagehandMetrics = {
    actPromptTokens: 0,
    actCompletionTokens: 0,
    actReasoningTokens: 0,
    actCachedInputTokens: 0,
    actInferenceTimeMs: 0,
    extractPromptTokens: 0,
    extractCompletionTokens: 0,
    extractReasoningTokens: 0,
    extractCachedInputTokens: 0,
    extractInferenceTimeMs: 0,
    observePromptTokens: 0,
    observeCompletionTokens: 0,
    observeReasoningTokens: 0,
    observeCachedInputTokens: 0,
    observeInferenceTimeMs: 0,
    agentPromptTokens: 0,
    agentCompletionTokens: 0,
    agentReasoningTokens: 0,
    agentCachedInputTokens: 0,
    agentInferenceTimeMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalReasoningTokens: 0,
    totalCachedInputTokens: 0,
    totalInferenceTimeMs: 0,
  };

  constructor(opts: V3Options) {
    V3._installProcessGuards();
    this.externalLogger = opts.logger;
    this.verbose = opts.verbose ?? 1;
    this.instanceId =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

    // Create per-instance StagehandLogger (handles usePino, verbose, externalLogger)
    // This gives each V3 instance independent logger configuration
    // while still sharing the underlying Pino worker thread via StagehandLogger.sharedPinoLogger
    const loggerOptions: LoggerOptions = {
      pretty: true,
      level: "info", // Most permissive - filtering happens at instance level
    };

    if (opts.disablePino !== undefined) {
      loggerOptions.usePino = !opts.disablePino;
    }

    this.stagehandLogger = new StagehandLogger(loggerOptions, opts.logger);
    this.stagehandLogger.setVerbosity(this.verbose);

    // Also bind to AsyncLocalStorage for v3Logger() calls from handlers
    // This maintains backward compatibility with code that uses v3Logger() directly
    try {
      if (this.externalLogger) {
        // Use external logger directly when provided
        bindInstanceLogger(this.instanceId, this.externalLogger);
      } else {
        // Fall back to stagehandLogger when no external logger
        bindInstanceLogger(this.instanceId, (line) => {
          this.stagehandLogger.log(line);
        });
      }
    } catch {
      // ignore
    }
    const { modelName, clientOptions } = resolveModelConfiguration(opts.model);
    this.modelName = modelName;
    this.experimental = opts.experimental ?? false;
    this.logInferenceToFile = opts.logInferenceToFile ?? false;
    this.llmProvider = new LLMProvider(this.logger);
    this.domSettleTimeoutMs = opts.domSettleTimeout;
    this.disableAPI = opts.disableAPI ?? false;

    const baseClientOptions: ClientOptions = clientOptions
      ? ({ ...clientOptions } as ClientOptions)
      : ({} as ClientOptions);
    if (opts.llmClient) {
      this.llmClient = opts.llmClient;
      this.modelClientOptions = baseClientOptions;
      this.disableAPI = true;
    } else {
      // Ensure API key is set
      let apiKey = (baseClientOptions as { apiKey?: string }).apiKey;
      if (!apiKey) {
        try {
          apiKey = loadApiKeyFromEnv(
            this.modelName.split("/")[0], // "openai", "anthropic", etc
            this.logger,
          );
        } catch (error) {
          this.logger({
            category: "init",
            message: `Error loading API key for model ${this.modelName}: ${error}. Continuing without LLM client.`,
            level: 0,
          });
          throw error;
        }
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

  /**
   * Async property for metrics so callers can `await v3.metrics`.
   * When using API mode, fetches metrics from the API. Otherwise returns local metrics.
   */
  public get metrics(): Promise<StagehandMetrics> {
    if (this.apiClient) {
      // Fetch metrics from the API
      return this.apiClient.getReplayMetrics().catch((error) => {
        this.logger({
          category: "metrics",
          message: `Failed to fetch metrics from API: ${error}`,
          level: 0,
        });
        // Fall back to local metrics on error
        return this.stagehandMetrics;
      });
    }
    // Return local metrics wrapped in a Promise for consistency
    return Promise.resolve(this.stagehandMetrics);
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
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ): void {
    switch (functionName) {
      case V3FunctionName.ACT:
        this.stagehandMetrics.actPromptTokens += promptTokens;
        this.stagehandMetrics.actCompletionTokens += completionTokens;
        this.stagehandMetrics.actReasoningTokens += reasoningTokens;
        this.stagehandMetrics.actCachedInputTokens += cachedInputTokens;
        this.stagehandMetrics.actInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.EXTRACT:
        this.stagehandMetrics.extractPromptTokens += promptTokens;
        this.stagehandMetrics.extractCompletionTokens += completionTokens;
        this.stagehandMetrics.extractReasoningTokens += reasoningTokens;
        this.stagehandMetrics.extractCachedInputTokens += cachedInputTokens;
        this.stagehandMetrics.extractInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.OBSERVE:
        this.stagehandMetrics.observePromptTokens += promptTokens;
        this.stagehandMetrics.observeCompletionTokens += completionTokens;
        this.stagehandMetrics.observeReasoningTokens += reasoningTokens;
        this.stagehandMetrics.observeCachedInputTokens += cachedInputTokens;
        this.stagehandMetrics.observeInferenceTimeMs += inferenceTimeMs;
        break;

      case V3FunctionName.AGENT:
        this.stagehandMetrics.agentPromptTokens += promptTokens;
        this.stagehandMetrics.agentCompletionTokens += completionTokens;
        this.stagehandMetrics.agentReasoningTokens += reasoningTokens;
        this.stagehandMetrics.agentCachedInputTokens += cachedInputTokens;
        this.stagehandMetrics.agentInferenceTimeMs += inferenceTimeMs;
        break;
    }
    this.updateTotalMetrics(
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedInputTokens,
      inferenceTimeMs,
    );
  }

  private updateTotalMetrics(
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ): void {
    this.stagehandMetrics.totalPromptTokens += promptTokens;
    this.stagehandMetrics.totalCompletionTokens += completionTokens;
    this.stagehandMetrics.totalReasoningTokens += reasoningTokens;
    this.stagehandMetrics.totalCachedInputTokens += cachedInputTokens;
    this.stagehandMetrics.totalInferenceTimeMs += inferenceTimeMs;
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

    process.once("SIGINT", () => {
      v3Logger({
        category: "v3",
        message: "SIGINT: initiating shutdown",
        level: 0,
      });
      for (const instance of V3._instances) {
        if (instance.apiClient) {
          void instance.apiClient.end();
          return;
        }
      }
      void shutdownAllImmediate("signal SIGINT");
    });
    process.once("SIGTERM", () => {
      v3Logger({
        category: "v3",
        message: "SIGTERM: initiating shutdown",
        level: 0,
      });
      for (const instance of V3._instances) {
        if (instance.apiClient) {
          void instance.apiClient.end();
          return;
        }
      }
      void shutdownAllImmediate("signal SIGTERM");
    });
    process.once("uncaughtException", (err: unknown) => {
      v3Logger({
        category: "v3",
        message: "uncaughtException",
        level: 0,
        auxiliary: { err: { value: String(err), type: "string" } },
      });
    });
    process.once("unhandledRejection", (reason: unknown) => {
      v3Logger({
        category: "v3",
        message: "unhandledRejection",
        level: 0,
        auxiliary: { reason: { value: String(reason), type: "string" } },
      });
    });
  }

  /**
   * Entrypoint: initializes handlers, launches Chrome or Browserbase,
   * and sets up a CDP context.
   */
  async init(): Promise<void> {
    try {
      return await withInstanceLogContext(this.instanceId, async () => {
        this.actHandler = new ActHandler(
          this.llmClient,
          this.modelName,
          this.modelClientOptions,
          (model) => this.resolveLlmClient(model),
          this.opts.systemPrompt ?? "",
          this.logInferenceToFile,
          this.opts.selfHeal ?? true,
          (
            functionName,
            promptTokens,
            completionTokens,
            reasoningTokens,
            cachedInputTokens,
            inferenceTimeMs,
          ) =>
            this.updateMetrics(
              functionName,
              promptTokens,
              completionTokens,
              reasoningTokens,
              cachedInputTokens,
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
          (
            functionName,
            promptTokens,
            completionTokens,
            reasoningTokens,
            cachedInputTokens,
            inferenceTimeMs,
          ) =>
            this.updateMetrics(
              functionName,
              promptTokens,
              completionTokens,
              reasoningTokens,
              cachedInputTokens,
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
          (
            functionName,
            promptTokens,
            completionTokens,
            reasoningTokens,
            cachedInputTokens,
            inferenceTimeMs,
          ) =>
            this.updateMetrics(
              functionName,
              promptTokens,
              completionTokens,
              reasoningTokens,
              cachedInputTokens,
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
            this.logger({
              category: "init",
              message: "Connecting to local browser",
              level: 1,
            });
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
            this.resetBrowserbaseSessionMetadata();
            // Post-connect settings (downloads and viewport) if provided
            await this._applyPostConnectLocalOptions(lbo);
            return;
          }
          this.logger({
            category: "init",
            message: "Launching local browser",
            level: 1,
          });

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
          this.resetBrowserbaseSessionMetadata();

          // Post-connect settings (downloads and viewport) if provided
          await this._applyPostConnectLocalOptions(lbo);
          return;
        }

        if (this.opts.env === "BROWSERBASE") {
          const { apiKey, projectId } = this.requireBrowserbaseCreds();
          if (!apiKey || !projectId) {
            throw new MissingEnvironmentVariableError(
              "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID",
              "Browserbase environment",
            );
          }
          this.logger({
            category: "init",
            message: "Starting browserbase session",
            level: 1,
          });
          if (!this.disableAPI && !this.experimental) {
            this.apiClient = new StagehandAPIClient({
              apiKey,
              projectId,
              logger: this.logger,
            });
            const createSessionPayload = {
              projectId:
                this.opts.browserbaseSessionCreateParams?.projectId ??
                projectId,
              ...this.opts.browserbaseSessionCreateParams,
              browserSettings: {
                ...(this.opts.browserbaseSessionCreateParams?.browserSettings ??
                  {}),
                viewport: this.opts.browserbaseSessionCreateParams
                  ?.browserSettings?.viewport ?? { width: 1288, height: 711 },
              },
              userMetadata: {
                ...(this.opts.browserbaseSessionCreateParams?.userMetadata ??
                  {}),
                stagehand: "true",
              },
            };
            const { sessionId, available } = await this.apiClient.init({
              modelName: this.modelName,
              modelApiKey: this.modelClientOptions.apiKey,
              domSettleTimeoutMs: this.domSettleTimeoutMs,
              verbose: this.verbose,
              systemPrompt: this.opts.systemPrompt,
              selfHeal: this.opts.selfHeal,
              browserbaseSessionCreateParams: createSessionPayload,
              browserbaseSessionID: this.opts.browserbaseSessionID,
            });
            if (!available) {
              this.apiClient = null;
            }
            this.opts.browserbaseSessionID = sessionId;
          }
          const { ws, sessionId, bb } = await createBrowserbaseSession(
            apiKey,
            projectId,
            this.opts.browserbaseSessionCreateParams,
            this.opts.browserbaseSessionID,
          );
          this.ctx = await V3Context.create(ws, {
            env: "BROWSERBASE",
            apiClient: this.apiClient,
          });
          this.ctx.conn.onTransportClosed(this._onCdpClosed);
          this.state = { kind: "BROWSERBASE", sessionId, ws, bb };
          this.browserbaseSessionId = sessionId;

          await this._ensureBrowserbaseDownloadsEnabled();

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
          this.browserbaseSessionUrl = sessionUrl;
          this.browserbaseDebugUrl = debugUrl;

          try {
            this.logger({
              category: "init",
              message: resumed
                ? this.apiClient
                  ? "Browserbase session started"
                  : "Browserbase session resumed"
                : "Browserbase session started",
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
        throw new StagehandInitError(`Unsupported env: ${neverEnv}`);
      });
    } catch (error) {
      // Cleanup instanceLoggers map on init failure to prevent memory leak
      if (this.externalLogger) {
        try {
          unbindInstanceLogger(this.instanceId);
        } catch {
          // ignore cleanup errors
        }
      }
      throw error;
    }
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

  private resetBrowserbaseSessionMetadata(): void {
    this.browserbaseSessionId = undefined;
    this.browserbaseSessionUrl = undefined;
    this.browserbaseDebugUrl = undefined;
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
      if (!this.actHandler) throw new StagehandNotInitializedError("act()");

      let actResult: ActResult;

      if (isObserveResult(input)) {
        // Resolve page: use provided page if any, otherwise default active page
        const v3Page = await this.resolvePage(options?.page);

        // Use selector as provided to support XPath, CSS, and other engines
        const selector = input.selector;
        if (this.apiClient) {
          actResult = await this.apiClient.act({
            input,
            options,
            frameId: v3Page.mainFrameId(),
          });
        } else {
          actResult = await this.actHandler.actFromObserveResult(
            { ...input, selector }, // ObserveResult
            v3Page, // V3 Page
            this.domSettleTimeoutMs,
            this.resolveLlmClient(options?.model),
          );
        }

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
        throw new StagehandInvalidArgumentError(
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
      if (this.apiClient) {
        const frameId = page.mainFrameId();
        actResult = await this.apiClient.act({ input, options, frameId });
      } else {
        actResult = await this.actHandler.act(handlerParams);
      }
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
  async extract<T extends StagehandZodSchema>(
    instruction: string,
    schema: T,
    options?: ExtractOptions,
  ): Promise<InferStagehandSchema<T>>;

  async extract(
    a?: string | ExtractOptions,
    b?: StagehandZodSchema | ExtractOptions,
    c?: ExtractOptions,
  ): Promise<unknown> {
    return await withInstanceLogContext(this.instanceId, async () => {
      if (!this.extractHandler) {
        throw new StagehandNotInitializedError("extract()");
      }

      // Normalize args
      let instruction: string | undefined;
      let schema: StagehandZodSchema | undefined;
      let options: ExtractOptions | undefined;

      if (typeof a === "string") {
        instruction = a;
        const isZodSchema = (val: unknown): val is StagehandZodSchema =>
          !!val &&
          typeof val === "object" &&
          "parse" in val &&
          "safeParse" in val;
        if (isZodSchema(b)) {
          schema = b as StagehandZodSchema;
          options = c as ExtractOptions | undefined;
        } else {
          options = b as ExtractOptions | undefined;
        }
      } else {
        // a is options or undefined
        options = (a as ExtractOptions) || undefined;
      }

      if (!instruction && schema) {
        throw new StagehandInvalidArgumentError(
          "extract(): schema provided without instruction",
        );
      }

      // If instruction without schema → defaultExtractSchema
      const effectiveSchema =
        instruction && !schema ? defaultExtractSchema : schema;

      // Resolve page from options or use active page
      const page = await this.resolvePage(options?.page);

      const handlerParams: ExtractHandlerParams<StagehandZodSchema> = {
        instruction,
        schema: effectiveSchema as StagehandZodSchema | undefined,
        model: options?.model,
        timeout: options?.timeout,
        selector: options?.selector,
        page,
      };
      let result: z.infer<typeof effectiveSchema> | { pageText: string };
      if (this.apiClient) {
        const frameId = page.mainFrameId();
        result = await this.apiClient.extract({
          instruction: handlerParams.instruction,
          schema: handlerParams.schema,
          options,
          frameId,
        });
      } else {
        result =
          await this.extractHandler.extract<StagehandZodSchema>(handlerParams);
      }
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
        throw new StagehandNotInitializedError("observe()");
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
        page: page!,
      };

      let results: Action[];
      if (this.apiClient) {
        const frameId = page.mainFrameId();
        results = await this.apiClient.observe({
          instruction,
          options,
          frameId,
        });
      } else {
        results = await this.observeHandler.observe(handlerParams);
      }

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
      throw new StagehandNotInitializedError("connectURL()");
    }
    return this.state.ws;
  }

  /** Expose the current CDP-backed context. */
  public get context(): V3Context {
    return this.ctx;
  }

  /** Best-effort cleanup of context and launched resources. */
  async close(opts?: { force?: boolean }): Promise<void> {
    if (this.apiClient) {
      await this.apiClient.end();
    }
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
      this.resetBrowserbaseSessionMetadata();
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
      throw new MissingEnvironmentVariableError(
        missing.join(", "),
        "Browserbase",
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
    // Delegate to per-instance StagehandLogger
    // StagehandLogger handles: verbosity filtering, usePino selection, external logger routing
    // This provides per-instance configuration while maintaining shared Pino optimization
    return (logLine: LogLine) => {
      const line = { ...logLine, level: logLine.level ?? 1 };
      this.stagehandLogger.log(line);
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

    throw new StagehandInvalidArgumentError(
      "Unsupported page object passed to V3.act()",
    );
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
      throw new StagehandNotInitializedError("resolvePage()");
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
        throw new StagehandInitError(
          "Failed to resolve V3 Page from Playwright page.",
        );
      return page;
    }
    if (this.isPatchrightPage(input)) {
      const frameId = await this.resolveTopFrameId(input);
      const page = this.ctx!.resolvePageByMainFrameId(frameId);
      if (!page)
        throw new StagehandInitError(
          "Failed to resolve V3 Page from Patchright page.",
        );
      return page;
    }
    if (this.isPuppeteerPage(input)) {
      const frameId = await this.resolveTopFrameId(input);
      const page = this.ctx!.resolvePageByMainFrameId(frameId);
      if (!page)
        throw new StagehandInitError(
          "Failed to resolve V3 Page from Puppeteer page.",
        );
      return page;
    }
    throw new StagehandInvalidArgumentError("Unsupported page object.");
  }

  private async _logBrowserbaseSessionStatus(): Promise<void> {
    if (this.state.kind !== "BROWSERBASE") {
      return;
    }

    try {
      const snapshot = (await this.state.bb.sessions.retrieve(
        this.state.sessionId,
      )) as { id?: string; status?: string };
      if (!snapshot?.status) return;

      const sessionId = snapshot.id ?? this.state.sessionId;
      const message =
        snapshot.status === "TIMED_OUT"
          ? `Browserbase session timed out (sessionId: ${sessionId})`
          : `Browserbase session status: ${snapshot.status}`;

      this.logger({
        category: "v3",
        message,
        level: 0,
      });
    } catch {
      // Ignore failures; nothing to log
    }
  }

  /**
   * Prepares shared context for agent execution (both execute and stream).
   * Extracts duplicated setup logic into a single helper.
   */
  private async prepareAgentExecution(
    options: AgentConfig | undefined,
    instructionOrOptions: string | AgentExecuteOptions,
    agentConfigSignature: string,
  ): Promise<{
    handler: V3AgentHandler;
    resolvedOptions: AgentExecuteOptions;
    instruction: string;
    cacheContext: AgentCacheContext | null;
  }> {
    if ((options?.integrations || options?.tools) && !this.experimental) {
      throw new ExperimentalNotConfiguredError(
        "MCP integrations and custom tools",
      );
    }

    const tools = options?.integrations
      ? await resolveTools(options.integrations, options.tools)
      : (options?.tools ?? {});

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
      const normalizedPage = await this.normalizeToV3Page(resolvedOptions.page);
      this.ctx!.setActivePage(normalizedPage);
    }

    const instruction = resolvedOptions.instruction.trim();
    const sanitizedOptions =
      this.agentCache.sanitizeExecuteOptions(resolvedOptions);

    const cacheContext = this.agentCache.shouldAttemptCache(instruction)
      ? await this.agentCache.prepareContext({
          instruction,
          options: sanitizedOptions,
          configSignature: agentConfigSignature,
          page: await this.ctx!.awaitActivePage(),
        })
      : null;

    return { handler, resolvedOptions, instruction, cacheContext };
  }

  /**
   * Create a v3 agent instance (AISDK tool-based) with execute().
   * Mirrors the v2 Stagehand.agent() tool mode (no CUA provider here).
   *
   * @overload When stream: true, returns a streaming agent where execute() returns AgentStreamResult
   * @overload When stream is false/undefined, returns a non-streaming agent where execute() returns AgentResult
   */
  agent(options: AgentConfig & { stream: true }): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentStreamResult>;
  };
  agent(options?: AgentConfig & { stream?: false }): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentResult>;
  };
  agent(options?: AgentConfig): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentResult | AgentStreamResult>;
  } {
    this.logger({
      category: "agent",
      message: `Creating v3 agent instance with options: ${JSON.stringify(options)}`,
      level: 1,
      auxiliary: {
        cua: { value: options?.cua ? "true" : "false", type: "boolean" },
        model: options?.model
          ? typeof options?.model === "string"
            ? { value: options.model, type: "string" }
            : { value: options.model.modelName, type: "string" }
          : { value: this.llmClient.modelName, type: "string" },
        systemPrompt: { value: options?.systemPrompt ?? "", type: "string" },
        tools: { value: JSON.stringify(options?.tools ?? {}), type: "object" },
        ...(options?.integrations && {
          integrations: {
            value: JSON.stringify(options.integrations),
            type: "object",
          },
        }),
      },
    });

    // If CUA is enabled, use the computer-use agent path
    if (options?.cua) {
      if (options?.stream) {
        throw new StagehandInvalidArgumentError(
          "Streaming is not supported with CUA (Computer Use Agent) mode. Remove either 'stream: true' or 'cua: true' from your agent config.",
        );
      }

      if ((options?.integrations || options?.tools) && !this.experimental) {
        throw new ExperimentalNotConfiguredError(
          "MCP integrations and custom tools",
        );
      }

      const modelToUse = options?.model || {
        modelName: this.modelName,
        ...this.modelClientOptions,
      };

      const { modelName, isCua, clientOptions } = resolveModel(modelToUse);

      if (!isCua) {
        throw new CuaModelRequiredError(AVAILABLE_CUA_MODELS);
      }

      const agentConfigSignature =
        this.agentCache.buildConfigSignature(options);
      return {
        execute: async (instructionOrOptions: string | AgentExecuteOptions) =>
          withInstanceLogContext(this.instanceId, async () => {
            if (options?.integrations && !this.experimental) {
              throw new ExperimentalNotConfiguredError("MCP integrations");
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

            let result: AgentResult;
            try {
              if (this.apiClient && !this.experimental) {
                const page = await this.ctx!.awaitActivePage();
                result = await this.apiClient.agentExecute(
                  options,
                  resolvedOptions,
                  page.mainFrameId(),
                );
              } else {
                result = await handler.execute(instructionOrOptions);
              }
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
    const isStreaming = options?.stream ?? false;

    return {
      execute: async (
        instructionOrOptions: string | AgentExecuteOptions,
      ): Promise<AgentResult | AgentStreamResult> =>
        withInstanceLogContext(this.instanceId, async () => {
          // Streaming mode
          if (isStreaming) {
            if (!this.experimental) {
              throw new ExperimentalNotConfiguredError("Agent streaming");
            }

            const { handler, cacheContext } = await this.prepareAgentExecution(
              options,
              instructionOrOptions,
              agentConfigSignature,
            );

            if (cacheContext) {
              const replayed =
                await this.agentCache.tryReplayAsStream(cacheContext);
              if (replayed) {
                return replayed;
              }
            }

            const streamResult = await handler.stream(instructionOrOptions);

            if (cacheContext) {
              return this.agentCache.wrapStreamForCaching(
                cacheContext,
                streamResult,
                () => this.beginAgentReplayRecording(),
                () => this.endAgentReplayRecording(),
                () => this.discardAgentReplayRecording(),
              );
            }

            return streamResult;
          }

          // Non-streaming mode (default)
          const { handler, resolvedOptions, cacheContext } =
            await this.prepareAgentExecution(
              options,
              instructionOrOptions,
              agentConfigSignature,
            );

          if (cacheContext) {
            const replayed = await this.agentCache.tryReplay(cacheContext);
            if (replayed) {
              return replayed;
            }
          }

          let agentSteps: AgentReplayStep[] = [];
          const recording = !!cacheContext;
          if (recording) {
            this.beginAgentReplayRecording();
          }
          let result: AgentResult;

          try {
            if (this.apiClient && !this.experimental) {
              const page = await this.ctx!.awaitActivePage();
              result = await this.apiClient.agentExecute(
                options,
                resolvedOptions,
                page.mainFrameId(),
              );
            } else {
              result = await handler.execute(instructionOrOptions);
            }
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
