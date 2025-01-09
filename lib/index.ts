import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "@playwright/test";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { BrowserResult } from "../types/browser";
import { LogLine } from "../types/log";
import { GotoOptions } from "../types/playwright";
import { Page, BrowserContext } from "../types/page";
import {
  ActOptions,
  ActResult,
  ConstructorParams,
  ExtractOptions,
  ExtractResult,
  InitFromPageOptions,
  InitFromPageResult,
  InitOptions,
  InitResult,
  ObserveOptions,
  ObserveResult,
} from "../types/stagehand";
import { scriptContent } from "./dom/build/scriptContent";
import { LLMClient } from "./llm/LLMClient";
import { LLMProvider } from "./llm/LLMProvider";
import { logLineToString } from "./utils";
import { StagehandPage } from "./StagehandPage";
import { StagehandContext } from "./StagehandContext";

dotenv.config({ path: ".env" });

const DEFAULT_MODEL_NAME = "gpt-4o";
const BROWSERBASE_REGION_DOMAIN = {
  "us-west-2": "wss://connect.usw2.browserbase.com",
  "us-east-1": "wss://connect.use1.browserbase.com",
  "eu-central-1": "wss://connect.euc1.browserbase.com",
  "ap-southeast-1": "wss://connect.apse1.browserbase.com",
};

async function getBrowser(
  apiKey: string | undefined,
  projectId: string | undefined,
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: LogLine) => void,
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams,
  browserbaseSessionID?: string,
): Promise<BrowserResult> {
  if (env === "BROWSERBASE") {
    if (!apiKey) {
      logger({
        category: "init",
        message:
          "BROWSERBASE_API_KEY is required to use BROWSERBASE env. Defaulting to LOCAL.",
        level: 0,
      });
      env = "LOCAL";
    }
    if (!projectId) {
      logger({
        category: "init",
        message:
          "BROWSERBASE_PROJECT_ID is required for some Browserbase features that may not work without it.",
        level: 1,
      });
    }
  }

  if (env === "BROWSERBASE") {
    if (!apiKey) {
      throw new Error("BROWSERBASE_API_KEY is required.");
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
        const sessionStatus =
          await browserbase.sessions.retrieve(browserbaseSessionID);

        if (sessionStatus.status !== "RUNNING") {
          throw new Error(
            `Session ${browserbaseSessionID} is not running (status: ${sessionStatus.status})`,
          );
        }

        sessionId = browserbaseSessionID;
        const browserbaseDomain =
          BROWSERBASE_REGION_DOMAIN[sessionStatus.region] ||
          "wss://connect.browserbase.com";
        connectUrl = `${browserbaseDomain}?apiKey=${apiKey}&sessionId=${sessionId}`;

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
          level: 1,
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
        level: 0,
      });

      if (!projectId) {
        throw new Error(
          "BROWSERBASE_PROJECT_ID is required for new Browserbase sessions.",
        );
      }

      const session = await browserbase.sessions.create({
        projectId,
        ...browserbaseSessionCreateParams,
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

    const browser = await chromium.connectOverCDP(connectUrl);
    const { debuggerUrl } = await browserbase.sessions.debug(sessionId);

    debugUrl = debuggerUrl;
    sessionUrl = `https://www.browserbase.com/sessions/${sessionId}`;

    logger({
      category: "init",
      message: browserbaseSessionID
        ? "browserbase session resumed"
        : "browserbase session started",
      level: 0,
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
    logger({
      category: "init",
      message: "launching local browser",
      level: 0,
      auxiliary: {
        headless: {
          value: headless.toString(),
          type: "boolean",
        },
      },
    });

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

    const downloadsPath = path.join(process.cwd(), "downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });

    const context = await chromium.launchPersistentContext(
      path.join(tmpDir, "userdir"),
      {
        acceptDownloads: true,
        headless: headless,
        viewport: {
          width: 1250,
          height: 800,
        },
        locale: "en-US",
        timezoneId: "America/New_York",
        deviceScaleFactor: 1,
        args: [
          "--enable-webgl",
          "--use-gl=swiftshader",
          "--enable-accelerated-2d-canvas",
          "--disable-blink-features=AutomationControlled",
          "--disable-web-security",
        ],
        bypassCSP: true,
      },
    );

    logger({
      category: "init",
      message: "local browser started successfully.",
    });

    await applyStealthScripts(context);

    return { context, contextPath: tmpDir, env: "LOCAL" };
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

const defaultLogger = async (logLine: LogLine) => {
  console.log(logLineToString(logLine));
};

export class Stagehand {
  private stagehandPage!: StagehandPage;
  private stagehandContext!: StagehandContext;
  private intEnv: "LOCAL" | "BROWSERBASE";

  public browserbaseSessionID?: string;
  public readonly domSettleTimeoutMs: number;
  public readonly debugDom: boolean;
  public readonly headless: boolean;
  public verbose: 0 | 1 | 2;
  public llmProvider: LLMProvider;
  public enableCaching: boolean;

  private apiKey: string | undefined;
  private projectId: string | undefined;
  // We want external logger to accept async functions
  private externalLogger?: (logLine: LogLine) => void;
  private browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  public variables: { [key: string]: unknown };
  private contextPath?: string;
  private llmClient: LLMClient;
  private userProvidedInstructions?: string;

  constructor(
    {
      env,
      apiKey,
      projectId,
      verbose,
      debugDom,
      llmProvider,
      llmClient,
      headless,
      logger,
      browserbaseSessionCreateParams,
      domSettleTimeoutMs,
      enableCaching,
      browserbaseSessionID,
      modelName,
      modelClientOptions,
      systemPrompt,
    }: ConstructorParams = {
      env: "BROWSERBASE",
    },
  ) {
    this.externalLogger = logger || defaultLogger;
    this.enableCaching =
      enableCaching ??
      (process.env.ENABLE_CACHING && process.env.ENABLE_CACHING === "true");
    this.llmProvider =
      llmProvider || new LLMProvider(this.logger, this.enableCaching);
    this.intEnv = env;
    this.apiKey = apiKey ?? process.env.BROWSERBASE_API_KEY;
    this.projectId = projectId ?? process.env.BROWSERBASE_PROJECT_ID;
    this.verbose = verbose ?? 0;
    this.debugDom = debugDom ?? false;
    if (llmClient) {
      this.llmClient = llmClient;
    } else {
      try {
        // try to set a default LLM client
        this.llmClient = this.llmProvider.getClient(
          modelName ?? DEFAULT_MODEL_NAME,
          modelClientOptions,
        );
      } catch {
        this.llmClient = undefined;
      }
    }

    this.domSettleTimeoutMs = domSettleTimeoutMs ?? 30_000;
    this.headless = headless ?? false;
    this.browserbaseSessionCreateParams = browserbaseSessionCreateParams;
    this.browserbaseSessionID = browserbaseSessionID;
    this.userProvidedInstructions = systemPrompt;
  }

  public get logger(): (logLine: LogLine) => void {
    return (logLine: LogLine) => {
      this.log(logLine);
    };
  }

  public get page(): Page {
    // End users should not be able to access the StagehandPage directly
    // This is a proxy to the underlying Playwright Page
    if (!this.stagehandPage) {
      throw new Error(
        "Stagehand not initialized. Make sure to await stagehand.init() first.",
      );
    }
    return this.stagehandPage.page;
  }

  public get env(): "LOCAL" | "BROWSERBASE" {
    if (this.intEnv === "BROWSERBASE" && this.apiKey && this.projectId) {
      return "BROWSERBASE";
    }
    return "LOCAL";
  }

  public get context(): BrowserContext {
    if (!this.stagehandContext) {
      throw new Error(
        "Stagehand not initialized. Make sure to await stagehand.init() first.",
      );
    }
    return this.stagehandContext.context;
  }

  async init(
    /** @deprecated Use constructor options instead */
    initOptions?: InitOptions,
  ): Promise<InitResult> {
    if (initOptions) {
      console.warn(
        "Passing parameters to init() is deprecated and will be removed in the next major version. Use constructor options instead.",
      );
    }
    const { context, debugUrl, sessionUrl, contextPath, sessionId, env } =
      await getBrowser(
        this.apiKey,
        this.projectId,
        this.env,
        this.headless,
        this.logger,
        this.browserbaseSessionCreateParams,
        this.browserbaseSessionID,
      ).catch((e) => {
        console.error("Error in init:", e);
        const br: BrowserResult = {
          context: undefined,
          debugUrl: undefined,
          sessionUrl: undefined,
          sessionId: undefined,
          env: this.env,
        };
        return br;
      });
    this.intEnv = env;
    this.contextPath = contextPath;
    this.stagehandContext = await StagehandContext.init(context, this);
    const defaultPage = this.context.pages()[0];
    this.stagehandPage = await new StagehandPage(
      defaultPage,
      this,
      this.stagehandContext,
      this.llmClient,
      this.userProvidedInstructions,
    ).init();

    // Set the browser to headless mode if specified
    if (this.headless) {
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }

    await this.context.addInitScript({
      content: scriptContent,
    });

    this.browserbaseSessionID = sessionId;

    return { debugUrl, sessionUrl, sessionId };
  }

  /** @deprecated initFromPage is deprecated and will be removed in the next major version. */
  async initFromPage({
    page,
  }: InitFromPageOptions): Promise<InitFromPageResult> {
    console.warn(
      "initFromPage is deprecated and will be removed in the next major version. To instantiate from a page, use `browserbaseSessionID` in the constructor.",
    );
    this.stagehandPage = await new StagehandPage(
      page,
      this,
      this.stagehandContext,
      this.llmClient,
    ).init();
    this.stagehandContext = await StagehandContext.init(page.context(), this);

    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: GotoOptions) => {
      const result = await originalGoto(url, options);
      if (this.debugDom) {
        await this.page.evaluate(() => (window.showChunks = this.debugDom));
      }
      await this.page.waitForLoadState("domcontentloaded");
      await this.stagehandPage._waitForSettledDom();
      return result;
    };

    // Set the browser to headless mode if specified
    if (this.headless) {
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }

    // Add initialization scripts
    await this.context.addInitScript({
      content: scriptContent,
    });

    return { context: this.context };
  }

  private pending_logs_to_send_to_browserbase: LogLine[] = [];

  private is_processing_browserbase_logs: boolean = false;

  log(logObj: LogLine): void {
    logObj.level = logObj.level ?? 1;

    // Normal Logging
    if (this.externalLogger) {
      this.externalLogger(logObj);
    }

    // Add the logs to the browserbase session
    this.pending_logs_to_send_to_browserbase.push({
      ...logObj,
      id: randomUUID(),
    });
    this._run_browserbase_log_processing_cycle();
  }

  private async _run_browserbase_log_processing_cycle() {
    if (this.is_processing_browserbase_logs) {
      return;
    }
    this.is_processing_browserbase_logs = true;
    const pending_logs = [...this.pending_logs_to_send_to_browserbase];
    for (const logObj of pending_logs) {
      await this._log_to_browserbase(logObj);
    }
    this.is_processing_browserbase_logs = false;
  }

  private async _log_to_browserbase(logObj: LogLine) {
    logObj.level = logObj.level ?? 1;

    if (!this.stagehandPage) {
      return;
    }

    if (this.verbose >= logObj.level) {
      await this.page
        .evaluate((logObj) => {
          const logMessage = logLineToString(logObj);
          if (
            logObj.message.toLowerCase().includes("trace") ||
            logObj.message.toLowerCase().includes("error:")
          ) {
            console.error(logMessage);
          } else {
            console.log(logMessage);
          }
        }, logObj)
        .then(() => {
          this.pending_logs_to_send_to_browserbase =
            this.pending_logs_to_send_to_browserbase.filter(
              (log) => log.id !== logObj.id,
            );
        })
        .catch(() => {
          // NAVIDTODO: Rerun the log call on the new page
          // This is expected to happen when the user is changing pages
          // console.error("Logging Error:", e);
          // this.log({
          //   category: "browserbase",
          //   message: "error logging to browserbase",
          //   level: 1,
          //   auxiliary: {
          //     trace: {
          //       value: e.stack,
          //       type: "string",
          //     },
          //     message: {
          //       value: e.message,
          //       type: "string",
          //     },
          //   },
          // });
        });
    }
  }

  /** @deprecated Use stagehand.page.act() instead. This will be removed in the next major release. */
  async act(options: ActOptions): Promise<ActResult> {
    return await this.stagehandPage.act(options);
  }

  /** @deprecated Use stagehand.page.extract() instead. This will be removed in the next major release. */
  async extract<T extends z.AnyZodObject>(
    options: ExtractOptions<T>,
  ): Promise<ExtractResult<T>> {
    return await this.stagehandPage.extract(options);
  }

  /** @deprecated Use stagehand.page.observe() instead. This will be removed in the next major release. */
  async observe(options?: ObserveOptions): Promise<ObserveResult[]> {
    return await this.stagehandPage.observe(options);
  }

  async close(): Promise<void> {
    await this.context.close();

    if (this.contextPath) {
      try {
        fs.rmSync(this.contextPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error deleting context directory:", e);
      }
    }
  }
}

export * from "../types/browser";
export * from "../types/log";
export * from "../types/model";
export * from "../types/playwright";
export * from "../types/stagehand";
export * from "../types/page";
export * from "./llm/LLMClient";
