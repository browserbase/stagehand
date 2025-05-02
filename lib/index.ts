import { Browserbase } from "@browserbasehq/sdk";
import { Browser, chromium } from "@playwright/test";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { BrowserResult } from "../types/browser";
import { EnhancedContext } from "../types/context";
import { LogLine } from "../types/log";
import { AvailableModel } from "../types/model";
import { BrowserContext, Page } from "../types/page";
import {
  ConstructorParams,
  InitResult,
  LocalBrowserLaunchOptions,
  AgentConfig,
  StagehandMetrics,
  StagehandFunctionName,
  HistoryEntry,
} from "../types/stagehand";
import { StagehandContext } from "./StagehandContext";
import { StagehandPage } from "./StagehandPage";
import { StagehandAPI } from "./api";
import { scriptContent } from "./dom/build/scriptContent";
import { LLMClient } from "./llm/LLMClient";
import { LLMProvider } from "./llm/LLMProvider";
import { ClientOptions } from "../types/model";
import { isRunningInBun, loadApiKeyFromEnv } from "./utils";
import { ApiResponse, ErrorResponse } from "@/types/api";
import { AgentExecuteOptions, AgentResult } from "../types/agent";
import { StagehandAgentHandler } from "./handlers/agentHandler";
import { StagehandOperatorHandler } from "./handlers/operatorHandler";
import { StagehandLogger } from "./logger";

import {
  StagehandError,
  StagehandNotInitializedError,
  StagehandEnvironmentError,
  MissingEnvironmentVariableError,
  UnsupportedModelError,
  UnsupportedAISDKModelProviderError,
  InvalidAISDKModelFormatError,
} from "../types/stagehandErrors";

dotenv.config({ path: ".env" });

const DEFAULT_MODEL_NAME = "gpt-4o";

// Initialize the global logger
let globalLogger: StagehandLogger;

const defaultLogger = async (logLine: LogLine, disablePino?: boolean) => {
  if (!globalLogger) {
    globalLogger = new StagehandLogger(
      {
        pretty: true,
        usePino: !disablePino,
      },
      undefined,
    );
  }
  globalLogger.log(logLine);
};

async function getBrowser(
  apiKey: string | undefined,
  projectId: string | undefined,
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: LogLine) => void,
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams,
  browserbaseSessionID?: string,
  localBrowserLaunchOptions?: LocalBrowserLaunchOptions,
): Promise<BrowserResult> {
  if (env === "BROWSERBASE") {
    if (!apiKey) {
      throw new MissingEnvironmentVariableError(
        "BROWSERBASE_API_KEY",
        "Browserbase",
      );
    }
    if (!projectId) {
      throw new MissingEnvironmentVariableError(
        "BROWSERBASE_PROJECT_ID",
        "Browserbase",
      );
    }

    let debugUrl: string | undefined = undefined;
    let sessionUrl: string | undefined = undefined;
    let sessionId: string;
    let connectUrl: string;

    const browserbase = new Browserbase({
      apiKey,
    });

    if (browserbaseSessionID) {
      // Validate the session status
      try {
        const session =
          await browserbase.sessions.retrieve(browserbaseSessionID);

        if (session.status !== "RUNNING") {
          throw new StagehandError(
            `Session ${browserbaseSessionID} is not running (status: ${session.status})`,
          );
        }

        sessionId = browserbaseSessionID;
        connectUrl = session.connectUrl;

        logger({
          category: "init",
          message: "resuming existing browserbase session...",
          level: 1,
          auxiliary: {
            sessionId: {
              value: sessionId,
              type: "string",
            },
          },
        });
      } catch (error) {
        logger({
          category: "init",
          message: "failed to resume session",
          level: 0,
          auxiliary: {
            error: {
              value: error.message,
              type: "string",
            },
            trace: {
              value: error.stack,
              type: "string",
            },
          },
        });
        throw error;
      }
    } else {
      // Create new session (existing code)
      logger({
        category: "init",
        message: "creating new browserbase session...",
        level: 1,
      });

      if (!projectId) {
        throw new StagehandError(
          "BROWSERBASE_PROJECT_ID is required for new Browserbase sessions.",
        );
      }

      const session = await browserbase.sessions.create({
        projectId,
        ...browserbaseSessionCreateParams,
        userMetadata: {
          ...(browserbaseSessionCreateParams?.userMetadata || {}),
          stagehand: "true",
        },
      });

      sessionId = session.id;
      connectUrl = session.connectUrl;
      logger({
        category: "init",
        message: "created new browserbase session",
        level: 1,
        auxiliary: {
          sessionId: {
            value: sessionId,
            type: "string",
          },
        },
      });
    }
    if (!connectUrl.includes("connect.connect")) {
      logger({
        category: "init",
        message: "connecting to browserbase session",
        level: 1,
        auxiliary: {
          connectUrl: {
            value: connectUrl,
            type: "string",
          },
        },
      });
    }
    const browser = await chromium.connectOverCDP(connectUrl);

    const { debuggerUrl } = await browserbase.sessions.debug(sessionId);

    debugUrl = debuggerUrl;
    sessionUrl = `https://www.browserbase.com/sessions/${sessionId}`;

    logger({
      category: "init",
      message: browserbaseSessionID
        ? "browserbase session resumed"
        : "browserbase session started",
      auxiliary: {
        sessionUrl: {
          value: sessionUrl,
          type: "string",
        },
        debugUrl: {
          value: debugUrl,
          type: "string",
        },
        sessionId: {
          value: sessionId,
          type: "string",
        },
      },
    });

    const context = browser.contexts()[0];

    return { browser, context, debugUrl, sessionUrl, sessionId, env };
  } else {
    if (localBrowserLaunchOptions?.cdpUrl) {
      if (!localBrowserLaunchOptions.cdpUrl.includes("connect.connect")) {
        logger({
          category: "init",
          message: "connecting to local browser via CDP URL",
          level: 1,
          auxiliary: {
            cdpUrl: {
              value: localBrowserLaunchOptions.cdpUrl,
              type: "string",
            },
          },
        });
      }

      const browser = await chromium.connectOverCDP(
        localBrowserLaunchOptions.cdpUrl,
      );
      const context = browser.contexts()[0];
      return { browser, context, env: "LOCAL" };
    }

    let userDataDir = localBrowserLaunchOptions?.userDataDir;
    if (!userDataDir) {
      const tmpDirPath = path.join(os.tmpdir(), "stagehand");
      if (!fs.existsSync(tmpDirPath)) {
        fs.mkdirSync(tmpDirPath, { recursive: true });
      }

      const tmpDir = fs.mkdtempSync(path.join(tmpDirPath, "ctx_"));
      fs.mkdirSync(path.join(tmpDir, "userdir/Default"), { recursive: true });

      const defaultPreferences = {
        plugins: {
          always_open_pdf_externally: true,
        },
      };

      fs.writeFileSync(
        path.join(tmpDir, "userdir/Default/Preferences"),
        JSON.stringify(defaultPreferences),
      );
      userDataDir = path.join(tmpDir, "userdir");
    }

    let downloadsPath = localBrowserLaunchOptions?.downloadsPath;
    if (!downloadsPath) {
      downloadsPath = path.join(process.cwd(), "downloads");
      fs.mkdirSync(downloadsPath, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      acceptDownloads: localBrowserLaunchOptions?.acceptDownloads ?? true,
      headless: localBrowserLaunchOptions?.headless ?? headless,
      viewport: {
        width: localBrowserLaunchOptions?.viewport?.width ?? 1024,
        height: localBrowserLaunchOptions?.viewport?.height ?? 768,
      },
      locale: localBrowserLaunchOptions?.locale ?? "en-US",
      timezoneId: localBrowserLaunchOptions?.timezoneId ?? "America/New_York",
      deviceScaleFactor: localBrowserLaunchOptions?.deviceScaleFactor ?? 1,
      args: localBrowserLaunchOptions?.args ?? [
        "--enable-webgl",
        "--use-gl=swiftshader",
        "--enable-accelerated-2d-canvas",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
      ],
      bypassCSP: localBrowserLaunchOptions?.bypassCSP ?? true,
      proxy: localBrowserLaunchOptions?.proxy,
      geolocation: localBrowserLaunchOptions?.geolocation,
      hasTouch: localBrowserLaunchOptions?.hasTouch ?? true,
      ignoreHTTPSErrors: localBrowserLaunchOptions?.ignoreHTTPSErrors ?? true,
      permissions: localBrowserLaunchOptions?.permissions,
      recordHar: localBrowserLaunchOptions?.recordHar,
      recordVideo: localBrowserLaunchOptions?.recordVideo,
      tracesDir: localBrowserLaunchOptions?.tracesDir,
      extraHTTPHeaders: localBrowserLaunchOptions?.extraHTTPHeaders,
      chromiumSandbox: localBrowserLaunchOptions?.chromiumSandbox ?? false,
      devtools: localBrowserLaunchOptions?.devtools ?? false,
      env: localBrowserLaunchOptions?.env,
      executablePath: localBrowserLaunchOptions?.executablePath,
      handleSIGHUP: localBrowserLaunchOptions?.handleSIGHUP ?? true,
      handleSIGINT: localBrowserLaunchOptions?.handleSIGINT ?? true,
      handleSIGTERM: localBrowserLaunchOptions?.handleSIGTERM ?? true,
      ignoreDefaultArgs: localBrowserLaunchOptions?.ignoreDefaultArgs,
    });

    if (localBrowserLaunchOptions?.cookies) {
      context.addCookies(localBrowserLaunchOptions.cookies);
    }
    // This will always be when null launched with chromium.launchPersistentContext, but not when connected over CDP to an existing browser
    const browser = context.browser();

    logger({
      category: "init",
      message: "local browser started successfully.",
    });

    await applyStealthScripts(context);

    return { browser, context, contextPath: userDataDir, env: "LOCAL" };
  }
}

async function applyStealthScripts(context: BrowserContext) {
  await context.addInitScript(() => {
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // Mock languages and plugins to mimic a real browser
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Remove Playwright-specific properties
    delete window.__playwright;
    delete window.__pw_manual;
    delete window.__PW_inspect;

    // Redefine the headless property
    Object.defineProperty(navigator, "headless", {
      get: () => false,
    });

    // Override the permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters);
  });
}

export class Stagehand {
  private stagehandPage!: StagehandPage;
  private stagehandContext!: StagehandContext;
  public browserbaseSessionID?: string;
  public readonly domSettleTimeoutMs: number;
  public readonly debugDom: boolean;
  public readonly headless: boolean;
  public verbose: 0 | 1 | 2;
  public llmProvider: LLMProvider;
  public enableCaching: boolean;
  private apiKey: string | undefined;
  private projectId: string | undefined;
  private externalLogger?: (logLine: LogLine) => void;
  private browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  public variables: { [key: string]: unknown };
  private contextPath?: string;
  public llmClient: LLMClient;
  public readonly userProvidedInstructions?: string;
  private usingAPI: boolean;
  private modelName: AvailableModel;
  public apiClient: StagehandAPI | undefined;
  public readonly waitForCaptchaSolves: boolean;
  private localBrowserLaunchOptions?: LocalBrowserLaunchOptions;
  public readonly selfHeal: boolean;
  private cleanupCalled = false;
  public readonly actTimeoutMs: number;
  public readonly logInferenceToFile?: boolean;
  private stagehandLogger: StagehandLogger;
  private disablePino: boolean;
  private modelClientOptions: ClientOptions;
  private _env: "LOCAL" | "BROWSERBASE";
  private _browser: Browser | undefined;
  protected setActivePage(page: StagehandPage): void {
    this.stagehandPage = page;
  }

  public get page(): Page {
    if (!this.stagehandContext) {
      throw new StagehandNotInitializedError("page");
    }
    return this.stagehandPage.page;
  }

  public stagehandMetrics: StagehandMetrics = {
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

  public get metrics(): StagehandMetrics {
    return this.stagehandMetrics;
  }

  public updateMetrics(
    functionName: StagehandFunctionName,
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ): void {
    switch (functionName) {
      case StagehandFunctionName.ACT:
        this.stagehandMetrics.actPromptTokens += promptTokens;
        this.stagehandMetrics.actCompletionTokens += completionTokens;
        this.stagehandMetrics.actInferenceTimeMs += inferenceTimeMs;
        break;

      case StagehandFunctionName.EXTRACT:
        this.stagehandMetrics.extractPromptTokens += promptTokens;
        this.stagehandMetrics.extractCompletionTokens += completionTokens;
        this.stagehandMetrics.extractInferenceTimeMs += inferenceTimeMs;
        break;

      case StagehandFunctionName.OBSERVE:
        this.stagehandMetrics.observePromptTokens += promptTokens;
        this.stagehandMetrics.observeCompletionTokens += completionTokens;
        this.stagehandMetrics.observeInferenceTimeMs += inferenceTimeMs;
        break;

      case StagehandFunctionName.AGENT:
        this.stagehandMetrics.agentPromptTokens += promptTokens;
        this.stagehandMetrics.agentCompletionTokens += completionTokens;
        this.stagehandMetrics.agentInferenceTimeMs += inferenceTimeMs;
        break;
    }
    this.updateTotalMetrics(promptTokens, completionTokens, inferenceTimeMs);
  }

  private updateTotalMetrics(
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ): void {
    this.stagehandMetrics.totalPromptTokens += promptTokens;
    this.stagehandMetrics.totalCompletionTokens += completionTokens;
    this.stagehandMetrics.totalInferenceTimeMs += inferenceTimeMs;
  }

  constructor(
    {
      env,
      apiKey,
      projectId,
      verbose,
      llmProvider,
      llmClient,
      logger,
      browserbaseSessionCreateParams,
      domSettleTimeoutMs,
      enableCaching,
      browserbaseSessionID,
      modelName,
      modelClientOptions,
      systemPrompt,
      useAPI,
      localBrowserLaunchOptions,
      waitForCaptchaSolves = false,
      logInferenceToFile = false,
      selfHeal = false,
      disablePino,
    }: ConstructorParams = {
      env: "BROWSERBASE",
    },
  ) {
    this.externalLogger =
      logger || ((logLine: LogLine) => defaultLogger(logLine, disablePino));

    // Initialize the Stagehand logger
    this.stagehandLogger = new StagehandLogger(
      {
        pretty: true,
        // use pino if pino is enabled, and there is no custom logger
        usePino: !logger && !disablePino,
      },
      this.externalLogger,
    );

    this.enableCaching =
      enableCaching ??
      (process.env.ENABLE_CACHING && process.env.ENABLE_CACHING === "true");

    this.llmProvider =
      llmProvider || new LLMProvider(this.logger, this.enableCaching);

    this.apiKey = apiKey ?? process.env.BROWSERBASE_API_KEY;
    this.projectId = projectId ?? process.env.BROWSERBASE_PROJECT_ID;

    // Store the environment value
    this._env = env ?? "BROWSERBASE";

    if (this._env === "BROWSERBASE") {
      if (!this.apiKey) {
        throw new MissingEnvironmentVariableError(
          "BROWSERBASE_API_KEY",
          "Browserbase",
        );
      } else if (!this.projectId) {
        throw new MissingEnvironmentVariableError(
          "BROWSERBASE_PROJECT_ID",
          "Browserbase",
        );
      }
    }

    this.verbose = verbose ?? 0;
    // Update logger verbosity level
    this.stagehandLogger.setVerbosity(this.verbose);
    this.modelName = modelName ?? DEFAULT_MODEL_NAME;

    let modelApiKey: string | undefined;

    if (!modelClientOptions?.apiKey) {
      // If no API key is provided, try to load it from the environment
      if (LLMProvider.getModelProvider(this.modelName) === "aisdk") {
        modelApiKey = loadApiKeyFromEnv(
          this.modelName.split("/")[0],
          this.logger,
        );
      } else {
        // Temporary add for legacy providers
        modelApiKey =
          LLMProvider.getModelProvider(this.modelName) === "openai"
            ? process.env.OPENAI_API_KEY ||
              this.llmClient?.clientOptions?.apiKey
            : LLMProvider.getModelProvider(this.modelName) === "anthropic"
              ? process.env.ANTHROPIC_API_KEY ||
                this.llmClient?.clientOptions?.apiKey
              : LLMProvider.getModelProvider(this.modelName) === "google"
                ? process.env.GOOGLE_API_KEY ||
                  this.llmClient?.clientOptions?.apiKey
                : undefined;
      }
      this.modelClientOptions = {
        ...modelClientOptions,
        apiKey: modelApiKey,
      };
    } else {
      this.modelClientOptions = modelClientOptions;
    }

    if (llmClient) {
      this.llmClient = llmClient;
    } else {
      try {
        // try to set a default LLM client
        this.llmClient = this.llmProvider.getClient(
          this.modelName,
          this.modelClientOptions,
        );
      } catch (error) {
        if (
          error instanceof UnsupportedAISDKModelProviderError ||
          error instanceof InvalidAISDKModelFormatError
        ) {
          throw error;
        }
        this.llmClient = undefined;
      }
    }

    this.domSettleTimeoutMs = domSettleTimeoutMs ?? 30_000;
    this.headless = localBrowserLaunchOptions?.headless ?? false;
    this.browserbaseSessionCreateParams = browserbaseSessionCreateParams;
    this.browserbaseSessionID = browserbaseSessionID;
    this.userProvidedInstructions = systemPrompt;
    this.usingAPI = useAPI ?? false;
    if (this.usingAPI && env === "LOCAL") {
      throw new StagehandEnvironmentError("LOCAL", "BROWSERBASE", "API mode");
    } else if (this.usingAPI && !process.env.STAGEHAND_API_URL) {
      throw new MissingEnvironmentVariableError(
        "STAGEHAND_API_URL",
        "API mode",
      );
    } else if (
      this.usingAPI &&
      this.llmClient &&
      !["openai", "anthropic", "google", "aisdk"].includes(this.llmClient.type)
    ) {
      throw new UnsupportedModelError(
        ["openai", "anthropic", "google", "aisdk"],
        "API mode",
      );
    }
    this.waitForCaptchaSolves = waitForCaptchaSolves;
    this.localBrowserLaunchOptions = localBrowserLaunchOptions;

    if (this.usingAPI) {
      this.registerSignalHandlers();
    }
    this.logInferenceToFile = logInferenceToFile;
    this.selfHeal = selfHeal;
    this.disablePino = disablePino;
  }

  private registerSignalHandlers() {
    const cleanup = async (signal: string) => {
      if (this.cleanupCalled) return;
      this.cleanupCalled = true;

      this.stagehandLogger.info(
        `[${signal}] received. Ending Browserbase session...`,
      );
      try {
        await this.close();
      } catch (err) {
        this.stagehandLogger.error("Error ending Browserbase session:", {
          error: String(err),
        });
      } finally {
        // Exit explicitly once cleanup is done
        process.exit(0);
      }
    };

    process.once("SIGINT", () => void cleanup("SIGINT"));
    process.once("SIGTERM", () => void cleanup("SIGTERM"));
  }

  public get logger(): (logLine: LogLine) => void {
    return (logLine: LogLine) => {
      this.log(logLine);
    };
  }

  public get env(): "LOCAL" | "BROWSERBASE" {
    if (this._env === "BROWSERBASE") {
      if (!this.apiKey) {
        throw new MissingEnvironmentVariableError(
          "BROWSERBASE_API_KEY",
          "Browserbase",
        );
      } else if (!this.projectId) {
        throw new MissingEnvironmentVariableError(
          "BROWSERBASE_PROJECT_ID",
          "Browserbase",
        );
      }
      return "BROWSERBASE";
    } else {
      return "LOCAL";
    }
  }

  public get context(): EnhancedContext {
    if (!this.stagehandContext) {
      throw new StagehandNotInitializedError("context");
    }
    return this.stagehandContext.context;
  }

  async init(): Promise<InitResult> {
    if (isRunningInBun()) {
      throw new StagehandError(
        "Playwright does not currently support the Bun runtime environment. " +
          "Please use Node.js instead. For more information, see: " +
          "https://github.com/microsoft/playwright/issues/27139",
      );
    }

    if (this.usingAPI) {
      this.apiClient = new StagehandAPI({
        apiKey: this.apiKey,
        projectId: this.projectId,
        logger: this.logger,
      });

      const modelApiKey = this.modelClientOptions?.apiKey;
      const { sessionId } = await this.apiClient.init({
        modelName: this.modelName,
        modelApiKey: modelApiKey,
        domSettleTimeoutMs: this.domSettleTimeoutMs,
        verbose: this.verbose,
        debugDom: this.debugDom,
        systemPrompt: this.userProvidedInstructions,
        selfHeal: this.selfHeal,
        waitForCaptchaSolves: this.waitForCaptchaSolves,
        actionTimeoutMs: this.actTimeoutMs,
        browserbaseSessionCreateParams: this.browserbaseSessionCreateParams,
        browserbaseSessionID: this.browserbaseSessionID,
      });
      this.browserbaseSessionID = sessionId;
    }

    const { browser, context, debugUrl, sessionUrl, contextPath, sessionId } =
      await getBrowser(
        this.apiKey,
        this.projectId,
        this.env,
        this.headless,
        this.logger,
        this.browserbaseSessionCreateParams,
        this.browserbaseSessionID,
        this.localBrowserLaunchOptions,
      ).catch((e) => {
        this.stagehandLogger.error("Error in init:", { error: String(e) });
        const br: BrowserResult = {
          context: undefined,
          debugUrl: undefined,
          sessionUrl: undefined,
          sessionId: undefined,
          env: this.env,
        };
        return br;
      });
    this.contextPath = contextPath;
    this._browser = browser;
    this.stagehandContext = await StagehandContext.init(context, this);

    const defaultPage = (await this.stagehandContext.getStagehandPages())[0];
    this.stagehandPage = defaultPage;

    if (this.headless) {
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }

    const guardedScript = `
  if (!window.__stagehandInjected) {
    window.__stagehandInjected = true;
    ${scriptContent}
  }
`;
    await this.context.addInitScript({
      content: guardedScript,
    });

    this.browserbaseSessionID = sessionId;

    return { debugUrl, sessionUrl, sessionId };
  }

  log(logObj: LogLine): void {
    logObj.level = logObj.level ?? 1;

    // Use our Pino-based logger
    this.stagehandLogger.log(logObj);
  }

  async close(): Promise<void> {
    if (this.apiClient) {
      const response = await this.apiClient.end();
      const body: ApiResponse<unknown> = await response.json();
      if (!body.success) {
        if (response.status == 409) {
          this.log({
            category: "close",
            message:
              "Warning: attempted to end a session that is not currently active",
            level: 0,
          });
        } else {
          throw new StagehandError((body as ErrorResponse).message);
        }
      }
      return;
    } else {
      await this.context.close();
      if (this._browser) {
        await this._browser.close();
      }
    }

    if (this.contextPath) {
      try {
        fs.rmSync(this.contextPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error deleting context directory:", e);
      }
    }
  }

  /**
   * Create an agent instance that can be executed with different instructions
   * @returns An agent instance with execute() method
   */
  agent(options?: AgentConfig): {
    execute: (
      instructionOrOptions: string | AgentExecuteOptions,
    ) => Promise<AgentResult>;
  } {
    if (!options || !options.provider) {
      // use open operator agent
      return {
        execute: async (instructionOrOptions: string | AgentExecuteOptions) => {
          return new StagehandOperatorHandler(
            this.stagehandPage,
            this.logger,
            this.llmClient,
          ).execute(instructionOrOptions);
        },
      };
    }

    const agentHandler = new StagehandAgentHandler(
      this,
      this.stagehandPage,
      this.logger,
      {
        modelName: options.model,
        clientOptions: options.options,
        userProvidedInstructions:
          options.instructions ??
          `You are a helpful assistant that can use a web browser.
      You are currently on the following page: ${this.stagehandPage.page.url()}.
      Do not ask follow up questions, the user will trust your judgement.`,
        agentType: options.provider,
      },
    );

    this.log({
      category: "agent",
      message: "Creating agent instance",
      level: 1,
    });

    return {
      execute: async (instructionOrOptions: string | AgentExecuteOptions) => {
        const executeOptions: AgentExecuteOptions =
          typeof instructionOrOptions === "string"
            ? { instruction: instructionOrOptions }
            : instructionOrOptions;

        if (!executeOptions.instruction) {
          throw new StagehandError(
            "Instruction is required for agent execution",
          );
        }

        if (this.usingAPI) {
          if (!this.apiClient) {
            throw new StagehandNotInitializedError("API client");
          }

          if (!options.options) {
            options.options = {};
          }

          if (options.provider === "anthropic") {
            options.options.apiKey = process.env.ANTHROPIC_API_KEY;
          } else if (options.provider === "openai") {
            options.options.apiKey = process.env.OPENAI_API_KEY;
          } else if (options.provider === "google") {
            options.options.apiKey = process.env.GOOGLE_API_KEY;
          }

          if (!options.options.apiKey) {
            throw new StagehandError(
              `API key not found for \`${options.provider}\` provider. Please set the ${options.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} environment variable or pass an apiKey in the options object.`,
            );
          }

          return await this.apiClient.agentExecute(options, executeOptions);
        }

        return await agentHandler.execute(executeOptions);
      },
    };
  }

  public get history(): ReadonlyArray<HistoryEntry> {
    if (!this.stagehandPage) {
      throw new StagehandNotInitializedError("history()");
    }

    return this.stagehandPage.history;
  }
}

export * from "../types/browser";
export * from "../types/log";
export * from "../types/model";
export * from "../types/page";
export * from "../types/playwright";
export * from "../types/stagehand";
export * from "../types/operator";
export * from "../types/agent";
export * from "./llm/LLMClient";
export * from "../types/stagehandErrors";
export * from "../types/stagehandApiErrors";
