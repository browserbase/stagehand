import { createHash } from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import type { ZodTypeAny } from "zod/v3";
import { z } from "zod/v3";
import { loadApiKeyFromEnv } from "../utils";
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
} from "./types/private/handlers";
import { InitState } from "./types/private/internal";
import {
  AgentConfig,
  AgentExecuteOptions,
  AgentModelConfig,
  AgentResult,
  AnyAgentExecuteOptions,
  AvailableCuaModel,
  CuaAgentExecuteOptions,
} from "./types/public/agent";
import type {
  AgentReplayActStep,
  AgentReplayFillFormStep,
  AgentReplayGotoStep,
  AgentReplayNavBackStep,
  AgentReplayScrollStep,
  AgentReplayStep,
  AgentReplayWaitStep,
  CachedActEntry,
  CachedAgentEntry,
  SanitizedAgentExecuteOptions,
} from "./types/public/cache";
import { LogLine } from "./types/public/logs";
import {
  Action,
  ActOptions,
  ActResult,
  defaultExtractSchema,
  ExtractOptions,
  HistoryEntry,
  ObserveOptions,
  pageTextSchema,
  V3FunctionName,
} from "./types/public/methods";
import { V3Metrics } from "./types/public/metrics";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "./types/public/model";
import { LocalBrowserLaunchOptions, V3Options } from "./types/public/options";
import {
  AnyPage,
  PatchrightPage,
  PlaywrightPage,
  PuppeteerPage,
} from "./types/public/page";
import { V3Context } from "./understudy/context";
import { Page } from "./understudy/page";
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
  public readonly disableAPI: boolean = false;
  private externalLogger?: (logLine: LogLine) => void;
  public verbose: 0 | 1 | 2 = 1;
  private _history: Array<HistoryEntry> = [];
  private readonly instanceId: string;
  private static _processGuardsInstalled = false;
  private static _instances: Set<V3> = new Set();
  private cacheDir?: string;
  private _agentReplayRecording: AgentReplayStep[] | null = null;
  private apiClient: StagehandAPIClient | null = null;

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
    this.disableAPI = opts.disableAPI ?? false;
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

    if (opts.cacheDir) {
      const resolvedCacheDir = path.resolve(opts.cacheDir);
      try {
        fs.mkdirSync(resolvedCacheDir, { recursive: true });
        this.cacheDir = resolvedCacheDir;
      } catch (err) {
        this.logger({
          category: "cache",
          message: `unable to initialize act cache directory: ${resolvedCacheDir}`,
          level: 1,
          auxiliary: {
            error: { value: String(err), type: "string" },
          },
        });
        this.cacheDir = undefined;
      }
    }

    this.opts = opts;
    // Track instance for global process guard handling
    V3._instances.add(this);
  }

  /**
   * Async property for metrics so callers can `await v3.metrics`.
   * Returning a Promise future-proofs async aggregation/storage.
   */
  public get metrics(): Promise<V3Metrics> {
    return Promise.resolve(this.v3Metrics);
  }

  private cloneForCache<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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
    this._agentReplayRecording = [];
  }

  private endAgentReplayRecording(): AgentReplayStep[] {
    if (!this._agentReplayRecording) return [];
    const steps = this.cloneForCache(this._agentReplayRecording);
    this._agentReplayRecording = null;
    return steps;
  }

  private discardAgentReplayRecording(): void {
    this._agentReplayRecording = null;
  }

  private isAgentReplayRecording(): boolean {
    return Array.isArray(this._agentReplayRecording);
  }

  public isAgentReplayActive(): boolean {
    return this.isAgentReplayRecording();
  }

  public recordAgentReplayStep(step: AgentReplayStep): void {
    if (!this.isAgentReplayRecording()) return;
    try {
      this._agentReplayRecording!.push(this.cloneForCache(step));
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
      for (const instance of V3._instances) {
        if (instance.apiClient) {
          void instance.apiClient.end();
          return;
        }
      }
      void shutdownAllImmediate("signal SIGINT");
      void exitAfter("SIGINT");
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
        if (!apiKey || !projectId) {
          throw new Error(
            "BROWSERBASE credentials missing. Provide in your v3 constructor, or set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in your .env",
          );
        }
        if (!this.disableAPI && !this.experimental) {
          this.apiClient = new StagehandAPIClient({
            apiKey,
            projectId,
            logger: this.logger,
          });
          this.logger({
            category: "init",
            message: "Starting browserbase session",
            level: 1,
          });
          const { sessionId, available } = await this.apiClient.init({
            modelName: this.modelName,
            modelApiKey: this.modelClientOptions.apiKey,
            domSettleTimeoutMs: this.domSettleTimeoutMs,
            verbose: this.verbose,
            systemPrompt: this.opts.systemPrompt,
            selfHeal: this.opts.selfHeal,
            browserbaseSessionCreateParams:
              this.opts.browserbaseSessionCreateParams,
            browserbaseSessionID: this.opts.browserbaseSessionID,
          });
          if (!available) {
            this.apiClient = null;
          }
          this.logger({
            category: "init",
            message: "Browserbase session started",
            level: 1,
          });
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
            deviceScaleFactor: lbo.deviceScaleFactor,
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

      let actResult: ActResult;

      if (isObserveResult(input)) {
        // Resolve page: use provided page if any, otherwise default active page
        let v3Page: Page;
        if (options?.page) {
          v3Page = await this.normalizeToV3Page(options.page);
        } else {
          v3Page = await this.ctx!.awaitActivePage();
        }

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
        throw new Error(
          "act(): instruction string is required unless passing an Action",
        );
      }

      // Resolve page from options or default
      let page: Page;
      if (options?.page) {
        if (options.page instanceof (await import("./understudy/page")).Page) {
          page = options.page as Page;
        } else if (this.isPlaywrightPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx!.resolvePageByMainFrameId(frameId);
        } else if (this.isPuppeteerPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx!.resolvePageByMainFrameId(frameId);
        } else if (this.isPatchrightPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx!.resolvePageByMainFrameId(frameId);
        } else {
          throw new Error("Unsupported page object provided to act().");
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

      let cacheKey: string | undefined;
      let pageUrlForCache: string | undefined;
      const canUseCache =
        !!this.cacheDir &&
        typeof input === "string" &&
        !this.isAgentReplayRecording();
      if (canUseCache) {
        pageUrlForCache = await this.safeGetPageUrl(page);
        cacheKey = this.buildActCacheKey(
          input,
          pageUrlForCache,
          options?.variables,
        );
        const cachedEntry = await this.readActCacheEntry(cacheKey);
        if (cachedEntry) {
          this.logger({
            category: "cache",
            message: "act cache hit",
            level: 1,
            auxiliary: {
              instruction: { value: input, type: "string" },
              url: {
                value: pageUrlForCache ?? "",
                type: "string",
              },
            },
          });
          const replayResult = await this.replayCachedActions(
            cachedEntry,
            page,
            options?.timeout,
            this.domSettleTimeoutMs,
          );
          this.addToHistory(
            "act",
            {
              instruction: input,
              variables: options?.variables,
              timeout: options?.timeout,
              cacheHit: true,
            },
            replayResult,
          );
          return replayResult;
        }
      }

      const handlerParams: ActHandlerParams = {
        instruction: input,
        page: page!,
        variables: options?.variables,
        timeout: options?.timeout,
        model: options?.model,
      };
      if (this.apiClient) {
        const frameId = page.mainFrameId();
        console.log("act frameId", frameId);
        // Don't pass the page object to the API
        if (options?.page) {
          options.page = null;
        }
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
        cacheKey &&
        pageUrlForCache !== undefined &&
        actResult.success &&
        Array.isArray(actResult.actions) &&
        actResult.actions.length > 0
      ) {
        await this.writeActCacheEntry(cacheKey, {
          version: 1,
          instruction: input.trim(),
          url: pageUrlForCache,
          variables: options?.variables ?? {},
          actions: actResult.actions,
          actionDescription: actResult.actionDescription,
          message: actResult.message,
        });
        this.logger({
          category: "cache",
          message: "act cache stored",
          level: 2,
          auxiliary: {
            instruction: { value: input, type: "string" },
            url: { value: pageUrlForCache, type: "string" },
          },
        });
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
      let page: Page;
      const pageArg: AnyPage | undefined = options?.page;
      if (pageArg) {
        if (pageArg instanceof (await import("./understudy/page")).Page) {
          page = pageArg as Page;
        } else if (this.isPlaywrightPage(pageArg)) {
          const frameId = await this.resolveTopFrameId(pageArg);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else if (this.isPuppeteerPage(pageArg)) {
          const frameId = await this.resolveTopFrameId(pageArg);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else if (this.isPatchrightPage(pageArg)) {
          const frameId = await this.resolveTopFrameId(pageArg);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else {
          throw new Error("Unsupported page object provided to extract().");
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

      const handlerParams: ExtractHandlerParams<ZodTypeAny> = {
        instruction,
        schema: effectiveSchema as unknown as ZodTypeAny | undefined,
        model: options?.model,
        timeout: options?.timeout,
        selector: options?.selector,
        page: page!,
      };
      let result: z.infer<typeof effectiveSchema> | { pageText: string };
      if (this.apiClient) {
        const frameId = page.mainFrameId();
        console.log("frameId", frameId);
        // Don't pass the page object to the API
        if (options?.page) {
          options.page = null;
        }
        result = await this.apiClient.extract({ ...handlerParams, frameId });
      } else {
        result = await this.extractHandler.extract<ZodTypeAny>(handlerParams);
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
      let page: Page;
      if (options?.page) {
        if (options.page instanceof (await import("./understudy/page")).Page) {
          page = options.page as Page;
        } else if (this.isPlaywrightPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else if (this.isPuppeteerPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else if (this.isPatchrightPage(options.page)) {
          const frameId = await this.resolveTopFrameId(options.page);
          page = this.ctx.resolvePageByMainFrameId(frameId);
        } else {
          throw new Error("Unsupported page object provided to observe().");
        }
      } else {
        page = await this.ctx!.awaitActivePage();
      }

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
        console.log("observe frameId", frameId);
        // Don't pass the page object to the API
        if (options?.page) {
          options.page = null;
        }
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

  private buildActCacheKey(
    instruction: string,
    url: string,
    variables?: Record<string, string>,
  ): string {
    const payload = JSON.stringify({
      instruction: instruction.trim(),
      url,
      variables: variables ?? {},
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  private async safeGetPageUrl(page: Page): Promise<string> {
    try {
      return page.url();
    } catch {
      return "";
    }
  }

  private async readActCacheEntry(
    cacheKey: string,
  ): Promise<CachedActEntry | null> {
    if (!this.cacheDir) return null;
    const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as CachedActEntry;
      if (parsed?.version !== 1) return null;
      if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
        return null;
      }
      if (!parsed.variables || typeof parsed.variables !== "object") {
        parsed.variables = {};
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        this.logger({
          category: "cache",
          message: `failed to read act cache entry: ${filePath}`,
          level: 2,
          auxiliary: {
            error: { value: String(err), type: "string" },
          },
        });
      }
      return null;
    }
  }

  private async writeActCacheEntry(
    cacheKey: string,
    entry: CachedActEntry,
  ): Promise<void> {
    if (!this.cacheDir) return;
    const dir = this.cacheDir;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${cacheKey}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(entry, null, 2),
        "utf8",
      );
    } catch (err) {
      this.logger({
        category: "cache",
        message: "failed to write act cache entry",
        level: 1,
        auxiliary: {
          error: { value: String(err), type: "string" },
        },
      });
    }
  }

  private sanitizeAgentExecuteOptions(
    options?: AnyAgentExecuteOptions,
  ): SanitizedAgentExecuteOptions {
    if (!options) return {};
    const sanitized: SanitizedAgentExecuteOptions = {};
    if (typeof options.maxSteps === "number")
      sanitized.maxSteps = options.maxSteps;
    return sanitized;
  }

  private createLlmClientOverride(
    model?: ModelConfiguration,
  ): LLMClient | undefined {
    if (!model) return undefined;

    let modelName: AvailableModel;
    let clientOptions: Record<string, unknown> | undefined;

    if (typeof model === "string") {
      modelName = model as AvailableModel;
    } else {
      const { modelName: configuredName, ...rest } = model;
      modelName = configuredName as AvailableModel;
      clientOptions = Object.keys(rest).length > 0 ? { ...rest } : undefined;
    }

    const hasApiKey =
      clientOptions !== undefined &&
      typeof (clientOptions as { apiKey?: unknown }).apiKey === "string" &&
      ((clientOptions as { apiKey?: string }).apiKey?.length ?? 0) > 0;

    if (!hasApiKey) {
      const providerSlug = modelName.includes("/")
        ? modelName.split("/")[0]
        : this.inferProviderFromModelName(modelName);
      const defaultProviderSlug = this.modelName.includes("/")
        ? this.modelName.split("/")[0]
        : this.inferProviderFromModelName(this.modelName);
      let apiKey = loadApiKeyFromEnv(providerSlug, this.logger);
      if (!apiKey && providerSlug && providerSlug === defaultProviderSlug) {
        apiKey = (this.modelClientOptions as { apiKey?: string })?.apiKey;
      }
      if (apiKey) {
        clientOptions = { ...(clientOptions ?? {}), apiKey };
      }
    }

    if (!clientOptions && modelName === this.modelName) {
      return this.llmClient;
    }

    return this.llmProvider.getClient(
      modelName,
      clientOptions as ClientOptions | undefined,
    );
  }

  private inferProviderFromModelName(modelName: string): string | undefined {
    const normalized = modelName.toLowerCase();
    if (normalized.startsWith("claude")) return "anthropic";
    if (normalized.startsWith("gpt") || normalized.startsWith("o"))
      return "openai";
    if (normalized.startsWith("gemini")) return "google";
    if (normalized.startsWith("groq")) return "groq";
    if (normalized.startsWith("cerebras")) return "cerebras";
    if (normalized.startsWith("moonshot")) return "groq";
    return undefined;
  }

  private extractAgentModel<T extends string>(
    model?: T | AgentModelConfig<T>,
    options?: { stripProviderPrefix?: boolean },
  ): {
    modelName?: string;
    modelOptions?: Record<string, unknown>;
  } {
    if (!model) return {};

    const stripPrefix = options?.stripProviderPrefix ?? false;

    const resolveName = (raw: string | undefined): string | undefined => {
      if (!raw) return raw;
      if (!stripPrefix) return raw;
      const parts = raw.split("/");
      return parts.length > 1 ? parts[parts.length - 1] : raw;
    };

    if (typeof model === "string") {
      return { modelName: resolveName(model) };
    }

    const { modelName, ...rest } = model;
    const normalizedName = resolveName(modelName);
    const modelOptions =
      Object.keys(rest).length > 0
        ? (rest as Record<string, unknown>)
        : undefined;
    return { modelName: normalizedName, modelOptions };
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

  private buildAgentCacheSignature(agentOptions?: AgentConfig): string {
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
      v3Model: this.modelName,
      systemPrompt: this.opts.systemPrompt ?? "",
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

  private buildAgentCacheKey(
    instruction: string,
    startUrl: string,
    options: SanitizedAgentExecuteOptions,
    configSignature: string,
  ): string {
    const payload = {
      instruction: instruction.trim(),
      startUrl,
      options,
      configSignature,
    };
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private async readAgentCacheEntry(
    cacheKey: string,
  ): Promise<CachedAgentEntry | null> {
    if (!this.cacheDir) return null;
    const filePath = path.join(this.cacheDir, `agent-${cacheKey}.json`);
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as CachedAgentEntry;
      if (parsed?.version !== 1) return null;
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        this.logger({
          category: "cache",
          message: `failed to read agent cache entry: ${filePath}`,
          level: 1,
          auxiliary: {
            error: { value: String(err), type: "string" },
          },
        });
      }
      return null;
    }
  }

  private async writeAgentCacheEntry(
    cacheKey: string,
    entry: CachedAgentEntry,
  ): Promise<void> {
    if (!this.cacheDir) return;
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      const filePath = path.join(this.cacheDir, `agent-${cacheKey}.json`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(this.cloneForCache(entry), null, 2),
        "utf8",
      );
    } catch (err) {
      this.logger({
        category: "cache",
        message: "failed to write agent cache entry",
        level: 1,
        auxiliary: {
          error: { value: String(err), type: "string" },
        },
      });
    }
  }

  private async replayAgentCacheEntry(
    entry: CachedAgentEntry,
  ): Promise<AgentResult | null> {
    if (!this.ctx || !this.actHandler) return null;
    try {
      for (const step of entry.steps ?? []) {
        await this.executeAgentReplayStep(step);
      }
      const result = this.cloneForCache(entry.result);
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

  private async executeAgentReplayStep(step: AgentReplayStep): Promise<void> {
    switch (step.type) {
      case "act":
        await this.replayAgentActStep(step as AgentReplayActStep);
        return;
      case "fillForm":
        await this.replayAgentFillFormStep(step as AgentReplayFillFormStep);
        return;
      case "goto":
        await this.replayAgentGotoStep(step as AgentReplayGotoStep);
        return;
      case "scroll":
        await this.replayAgentScrollStep(step as AgentReplayScrollStep);
        return;
      case "wait":
        await this.replayAgentWaitStep(step as AgentReplayWaitStep);
        return;
      case "navback":
        await this.replayAgentNavBackStep(step as AgentReplayNavBackStep);
        return;
      case "close":
      case "extract":
      case "screenshot":
      case "ariaTree":
        return;
      default:
        // Non-mutating tools (screenshot, extract, etc.) are skipped during replay
        this.logger({
          category: "cache",
          message: `agent cache skipping step type: ${step.type}`,
          level: 2,
        });
    }
  }

  private async replayAgentActStep(step: AgentReplayActStep): Promise<void> {
    if (!this.actHandler)
      throw new Error("V3 not initialized. Call init() before agent replay.");
    const actions = Array.isArray(step.actions) ? step.actions : [];
    if (actions.length > 0) {
      const page = await this.ctx!.awaitActivePage();
      for (const action of actions) {
        await this.actHandler.actFromObserveResult(
          action,
          page,
          this.domSettleTimeoutMs,
          this.resolveLlmClient(),
        );
      }
      return;
    }
    await this.act(step.instruction, { timeout: step.timeout });
  }

  private async replayAgentFillFormStep(
    step: AgentReplayFillFormStep,
  ): Promise<void> {
    if (!this.actHandler)
      throw new Error("V3 not initialized. Call init() before agent replay.");
    const actions =
      Array.isArray(step.actions) && step.actions.length > 0
        ? step.actions
        : (step.observeResults ?? []);
    if (!Array.isArray(actions) || actions.length === 0) return;
    const page = await this.ctx!.awaitActivePage();
    for (const action of actions) {
      await this.actHandler.actFromObserveResult(
        action,
        page,
        this.domSettleTimeoutMs,
        this.resolveLlmClient(),
      );
    }
  }

  private async replayAgentGotoStep(step: AgentReplayGotoStep): Promise<void> {
    const page = await this.ctx!.awaitActivePage();
    await page.goto(step.url, { waitUntil: step.waitUntil ?? "load" });
  }

  private async replayAgentScrollStep(
    step: AgentReplayScrollStep,
  ): Promise<void> {
    const page = await this.ctx!.awaitActivePage();
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
  ): Promise<void> {
    const page = await this.ctx!.awaitActivePage();
    await page.goBack({ waitUntil: step.waitUntil ?? "domcontentloaded" });
  }

  private async replayCachedActions(
    entry: CachedActEntry,
    page: Page,
    timeout?: number,
    domSettleTimeoutMs?: number,
  ): Promise<ActResult> {
    if (!this.actHandler) {
      throw new Error("V3 not initialized. Call init() before act().");
    }

    const execute = async (): Promise<ActResult> => {
      const actionResults: ActResult[] = [];
      for (const action of entry.actions) {
        const result = await this.actHandler!.actFromObserveResult(
          action,
          page,
          domSettleTimeoutMs,
          this.resolveLlmClient(),
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

    return await this.runWithActTimeout(execute, timeout);
  }

  private async runWithActTimeout<T>(
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

  /**
   * Create a v3 agent instance (AISDK tool-based) with execute().
   * Mirrors the v2 Stagehand.agent() tool mode (no CUA provider here).
   */
  agent(options: AgentConfig & { cua: true }): {
    execute: (
      instructionOrOptions: string | CuaAgentExecuteOptions,
    ) => Promise<AgentResult>;
  };
  agent(options?: AgentConfig & { cua?: false }): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentResult>;
  };
  agent(options?: AgentConfig): {
    execute: (
      instructionOrOptions: string | AnyAgentExecuteOptions,
    ) => Promise<AgentResult>;
  } {
    this.logger({
      category: "agent",
      message: "Creating v3 agent instance",
      level: 1,
    });

    // If CUA is enabled, use the computer-use agent path
    if (options?.cua) {
      const { modelName, modelOptions } =
        this.extractAgentModel<AvailableCuaModel>(options.model, {
          stripProviderPrefix: true,
        });
      if (!modelName) {
        throw new Error("A CUA agent requires a model to be specified.");
      }

      const executionModel = (
        options as {
          executionModel?: unknown;
        }
      ).executionModel;
      if (executionModel !== undefined) {
        throw new Error(
          "executionModel is not supported when cua is set to true.",
        );
      }

      const agentConfigSignature = this.buildAgentCacheSignature(options);
      return {
        execute: async (
          instructionOrOptions: string | CuaAgentExecuteOptions,
        ) =>
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
                clientOptions: modelOptions,
                userProvidedInstructions:
                  options.systemPrompt ??
                  `You are a helpful assistant that can use a web browser.\nDo not ask follow up questions, the user will trust your judgement.`,
              },
              tools,
            );

            const resolvedOptions: CuaAgentExecuteOptions =
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

            const shouldAttemptCache =
              !!this.cacheDir && instruction.length > 0;
            const sanitizedOptions =
              this.sanitizeAgentExecuteOptions(resolvedOptions);

            let cacheKey: string | undefined;
            let startUrl: string | undefined;
            if (shouldAttemptCache) {
              const startPage = await this.ctx!.awaitActivePage();
              startUrl = await this.safeGetPageUrl(startPage);
              cacheKey = this.buildAgentCacheKey(
                instruction,
                startUrl,
                sanitizedOptions,
                agentConfigSignature,
              );
              const cachedEntry = await this.readAgentCacheEntry(cacheKey);
              if (cachedEntry) {
                this.logger({
                  category: "cache",
                  message: "agent cache hit",
                  level: 1,
                  auxiliary: {
                    instruction: { value: instruction, type: "string" },
                    url: { value: startUrl, type: "string" },
                  },
                });
                const replayed = await this.replayAgentCacheEntry(cachedEntry);
                if (replayed) {
                  return replayed;
                }
              }
            }

            let agentSteps: AgentReplayStep[] = [];
            let recording = false;
            if (shouldAttemptCache) {
              this.beginAgentReplayRecording();
              recording = true;
            }

            try {
              const result = await handler.execute(instructionOrOptions);
              if (recording) {
                agentSteps = this.endAgentReplayRecording();
              }

              if (
                shouldAttemptCache &&
                cacheKey &&
                startUrl !== undefined &&
                result.success &&
                agentSteps.length > 0
              ) {
                await this.writeAgentCacheEntry(cacheKey, {
                  version: 1,
                  instruction,
                  startUrl,
                  options: sanitizedOptions,
                  configSignature: agentConfigSignature,
                  steps: agentSteps,
                  result: this.cloneForCache(result),
                  timestamp: new Date().toISOString(),
                });
                this.logger({
                  category: "cache",
                  message: "agent cache stored",
                  level: 2,
                  auxiliary: {
                    instruction: { value: instruction, type: "string" },
                    steps: { value: String(agentSteps.length), type: "string" },
                  },
                });
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
    const agentConfigSignature = this.buildAgentCacheSignature(options);

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
            options?.executionModel,
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

          const shouldAttemptCache = !!this.cacheDir && instruction.length > 0;
          const sanitizedOptions =
            this.sanitizeAgentExecuteOptions(resolvedOptions);

          let cacheKey: string | undefined;
          let startUrl: string | undefined;
          if (shouldAttemptCache) {
            const startPage = await this.ctx!.awaitActivePage();
            startUrl = await this.safeGetPageUrl(startPage);
            cacheKey = this.buildAgentCacheKey(
              instruction,
              startUrl,
              sanitizedOptions,
              agentConfigSignature,
            );
            const cachedEntry = await this.readAgentCacheEntry(cacheKey);
            if (cachedEntry) {
              this.logger({
                category: "cache",
                message: "agent cache hit",
                level: 1,
                auxiliary: {
                  instruction: { value: instruction, type: "string" },
                  url: { value: startUrl, type: "string" },
                },
              });
              const replayed = await this.replayAgentCacheEntry(cachedEntry);
              if (replayed) {
                return replayed;
              }
            }
          }

          let agentSteps: AgentReplayStep[] = [];
          let recording = false;
          if (shouldAttemptCache) {
            this.beginAgentReplayRecording();
            recording = true;
          }

          try {
            const result = await handler.execute(instructionOrOptions);
            if (recording) {
              agentSteps = this.endAgentReplayRecording();
            }

            if (
              shouldAttemptCache &&
              cacheKey &&
              startUrl !== undefined &&
              result.success &&
              agentSteps.length > 0
            ) {
              await this.writeAgentCacheEntry(cacheKey, {
                version: 1,
                instruction,
                startUrl,
                options: sanitizedOptions,
                configSignature: agentConfigSignature,
                steps: agentSteps,
                result: this.cloneForCache(result),
                timestamp: new Date().toISOString(),
              });
              this.logger({
                category: "cache",
                message: "agent cache stored",
                level: 2,
                auxiliary: {
                  instruction: { value: instruction, type: "string" },
                  steps: {
                    value: String(agentSteps.length),
                    type: "string",
                  },
                },
              });
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
