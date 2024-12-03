import { Browserbase } from "@browserbasehq/sdk";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { BrowserResult } from "../types/browser";
import { LogLine } from "../types/log";
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
import { StagehandActHandler } from "./handlers/actHandler";
import { StagehandExtractHandler } from "./handlers/extractHandler";
import { StagehandObserveHandler } from "./handlers/observeHandler";
import { LLMClient } from "./llm/LLMClient";
import { LLMProvider } from "./llm/LLMProvider";
import { logLineToString } from "./utils";

require("dotenv").config({ path: ".env" });

const DEFAULT_MODEL_NAME = "gpt-4o";

async function getBrowser(
  apiKey: string | undefined,
  projectId: string | undefined,
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: LogLine) => void,
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams,
  browserbaseResumeSessionID?: string,
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

    if (browserbaseResumeSessionID) {
      // Validate the session status
      try {
        const sessionStatus = await browserbase.sessions.retrieve(
          browserbaseResumeSessionID,
        );

        if (sessionStatus.status !== "RUNNING") {
          throw new Error(
            `Session ${browserbaseResumeSessionID} is not running (status: ${sessionStatus.status})`,
          );
        }

        sessionId = browserbaseResumeSessionID;
        connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`;

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
      message: browserbaseResumeSessionID
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

    return { browser, context, debugUrl, sessionUrl };
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

    return { context, contextPath: tmpDir };
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
    delete (window as any).__playwright;
    delete (window as any).__pw_manual;
    delete (window as any).__PW_inspect;

    // Redefine the headless property
    Object.defineProperty(navigator, "headless", {
      get: () => false,
    });

    // Override the permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters);
  });
}

export class Stagehand {
  private llmProvider: LLMProvider;
  private llmClient: LLMClient;
  public page: Page;
  public context: BrowserContext;
  private env: "LOCAL" | "BROWSERBASE";
  private apiKey: string | undefined;
  private projectId: string | undefined;
  private verbose: 0 | 1 | 2;
  private debugDom: boolean;
  private headless: boolean;
  private logger: (logLine: LogLine) => void;
  private externalLogger?: (logLine: LogLine) => void;
  private domSettleTimeoutMs: number;
  private browserBaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  private enableCaching: boolean;
  private variables: { [key: string]: any };
  private browserbaseResumeSessionID?: string;
  private contextPath?: string;

  private actHandler?: StagehandActHandler;
  private extractHandler?: StagehandExtractHandler;
  private observeHandler?: StagehandObserveHandler;

  constructor(
    {
      env,
      apiKey,
      projectId,
      verbose,
      debugDom,
      llmProvider,
      headless,
      logger,
      browserBaseSessionCreateParams,
      domSettleTimeoutMs,
      enableCaching,
      browserbaseResumeSessionID,
      modelName,
      modelClientOptions,
    }: ConstructorParams = {
      env: "BROWSERBASE",
    },
  ) {
    this.externalLogger = logger;
    this.logger = this.log.bind(this);
    this.enableCaching =
      enableCaching ??
      (process.env.ENABLE_CACHING && process.env.ENABLE_CACHING === "true");
    this.llmProvider =
      llmProvider || new LLMProvider(this.logger, this.enableCaching);
    this.env = env;
    this.apiKey = apiKey ?? process.env.BROWSERBASE_API_KEY;
    this.projectId = projectId ?? process.env.BROWSERBASE_PROJECT_ID;
    this.verbose = verbose ?? 0;
    this.debugDom = debugDom ?? false;
    this.llmClient = this.llmProvider.getClient(
      modelName ?? DEFAULT_MODEL_NAME,
      modelClientOptions,
    );
    this.domSettleTimeoutMs = domSettleTimeoutMs ?? 30_000;
    this.headless = headless ?? false;
    this.browserBaseSessionCreateParams = browserBaseSessionCreateParams;
    this.browserbaseResumeSessionID = browserbaseResumeSessionID;
  }

  async init({
    modelName,
    modelClientOptions,
    domSettleTimeoutMs,
  }: InitOptions = {}): Promise<InitResult> {
    const llmClient = modelName
      ? this.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;
    const { context, debugUrl, sessionUrl, contextPath } = await getBrowser(
      this.apiKey,
      this.projectId,
      this.env,
      this.headless,
      this.logger,
      this.browserBaseSessionCreateParams,
      this.browserbaseResumeSessionID,
    ).catch((e) => {
      console.error("Error in init:", e);
      return {
        context: undefined,
        debugUrl: undefined,
        sessionUrl: undefined,
      } as BrowserResult;
    });
    this.contextPath = contextPath;
    this.context = context;
    this.page = context.pages()[0];
    // Redundant but needed for users who are re-connecting to a previously-created session
    await this.page.waitForLoadState("domcontentloaded");
    await this._waitForSettledDom();
    this.domSettleTimeoutMs = domSettleTimeoutMs ?? this.domSettleTimeoutMs;

    // Overload the page.goto method
    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, options);
      if (this.debugDom) {
        await this.page.evaluate(() => (window.showChunks = this.debugDom));
      }
      await this.page.waitForLoadState("domcontentloaded");
      await this._waitForSettledDom();
      return result;
    };

    // Set the browser to headless mode if specified
    if (this.headless) {
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }

    await this.context.addInitScript({
      content: scriptContent,
    });

    this.actHandler = new StagehandActHandler({
      stagehand: this,
      verbose: this.verbose,
      llmProvider: this.llmProvider,
      enableCaching: this.enableCaching,
      logger: this.logger,
      waitForSettledDom: this._waitForSettledDom.bind(this),
      startDomDebug: this.startDomDebug.bind(this),
      cleanupDomDebug: this.cleanupDomDebug.bind(this),
      llmClient,
    });

    this.extractHandler = new StagehandExtractHandler({
      stagehand: this,
      logger: this.logger,
      waitForSettledDom: this._waitForSettledDom.bind(this),
      startDomDebug: this.startDomDebug.bind(this),
      cleanupDomDebug: this.cleanupDomDebug.bind(this),
      llmProvider: this.llmProvider,
      verbose: this.verbose,
      llmClient,
    });

    this.observeHandler = new StagehandObserveHandler({
      stagehand: this,
      logger: this.logger,
      waitForSettledDom: this._waitForSettledDom.bind(this),
      startDomDebug: this.startDomDebug.bind(this),
      cleanupDomDebug: this.cleanupDomDebug.bind(this),
      llmProvider: this.llmProvider,
      verbose: this.verbose,
      llmClient,
    });

    this.llmClient = llmClient;
    return { debugUrl, sessionUrl };
  }

  async initFromPage({
    page,
    modelName,
    modelClientOptions,
  }: InitFromPageOptions): Promise<InitFromPageResult> {
    this.page = page;
    this.context = page.context();
    this.llmClient = modelName
      ? this.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, options);
      if (this.debugDom) {
        await this.page.evaluate(() => (window.showChunks = this.debugDom));
      }
      await this.page.waitForLoadState("domcontentloaded");
      await this._waitForSettledDom();
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
    logObj.level = logObj.level || 1;

    // Normal Logging
    if (this.externalLogger) {
      this.externalLogger(logObj);
    } else {
      const logMessage = logLineToString(logObj);
      console.log(logMessage);
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
    logObj.level = logObj.level || 1;

    if (!this.page) {
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
        .catch((e) => {
          // NAVIDTODO: Rerun the log call on the new page
          // This is expected to happen when the user is changing pages
          // console.error("Logging Error:", e);
        });
    }
  }

  private async _waitForSettledDom(timeoutMs?: number) {
    try {
      const timeout = timeoutMs ?? this.domSettleTimeoutMs;
      let timeoutHandle: NodeJS.Timeout;

      const timeoutPromise = new Promise<void>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          this.log({
            category: "dom",
            message: "DOM settle timeout exceeded, continuing anyway",
            level: 1,
            auxiliary: {
              timeout_ms: {
                value: timeout.toString(),
                type: "integer",
              },
            },
          });
          resolve();
        }, timeout);
      });

      try {
        await Promise.race([
          this.page.evaluate(() => {
            return new Promise<void>((resolve) => {
              if (typeof window.waitForDomSettle === "function") {
                window.waitForDomSettle().then(resolve);
              } else {
                console.warn(
                  "waitForDomSettle is not defined, considering DOM as settled",
                );
                resolve();
              }
            });
          }),
          this.page.waitForLoadState("domcontentloaded"),
          this.page.waitForSelector("body"),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutHandle!);
      }
    } catch (e) {
      this.log({
        category: "dom",
        message: "Error in waitForSettledDom",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
        },
      });
    }
  }

  private async startDomDebug() {
    try {
      await this.page
        .evaluate(() => {
          if (typeof window.debugDom === "function") {
            window.debugDom();
          } else {
            this.log({
              category: "dom",
              message: "debugDom is not defined",
              level: 1,
            });
          }
        })
        .catch(() => {});
    } catch (e) {
      this.log({
        category: "dom",
        message: "Error in startDomDebug",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
        },
      });
    }
  }

  private async cleanupDomDebug() {
    if (this.debugDom) {
      await this.page.evaluate(() => window.cleanupDebug()).catch(() => {});
    }
  }

  async act({
    action,
    modelName,
    modelClientOptions,
    useVision = "fallback",
    variables = {},
    domSettleTimeoutMs,
  }: ActOptions): Promise<ActResult> {
    if (!this.actHandler) {
      throw new Error("Act handler not initialized");
    }

    useVision = useVision ?? "fallback";
    const requestId = Math.random().toString(36).substring(2);
    const llmClient: LLMClient = modelName
      ? this.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    this.log({
      category: "act",
      message: "running act",
      level: 1,
      auxiliary: {
        action: {
          value: action,
          type: "string",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
        modelName: {
          value: llmClient.modelName,
          type: "string",
        },
      },
    });

    if (variables) {
      this.variables = { ...this.variables, ...variables };
    }

    return this.actHandler
      .act({
        action,
        llmClient,
        chunksSeen: [],
        useVision,
        verifierUseVision: useVision !== false,
        requestId,
        variables,
        previousSelectors: [],
        skipActionCacheForThisStep: false,
        domSettleTimeoutMs,
      })
      .catch((e) => {
        this.log({
          category: "act",
          message: "error acting",
          level: 1,
          auxiliary: {
            error: {
              value: e.message,
              type: "string",
            },
            trace: {
              value: e.stack,
              type: "string",
            },
          },
        });

        return {
          success: false,
          message: `Internal error: Error acting: ${e.message}`,
          action: action,
        };
      });
  }

  async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    modelName,
    modelClientOptions,
    domSettleTimeoutMs,
  }: ExtractOptions<T>): Promise<ExtractResult<T>> {
    if (!this.extractHandler) {
      throw new Error("Extract handler not initialized");
    }

    const requestId = Math.random().toString(36).substring(2);
    const llmClient = modelName
      ? this.llmProvider.getClient(modelName, modelClientOptions)
      : this.llmClient;

    this.logger({
      category: "extract",
      message: "running extract",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
        modelName: {
          value: llmClient.modelName,
          type: "string",
        },
      },
    });

    return this.extractHandler
      .extract({
        instruction,
        schema,
        llmClient,
        requestId,
        domSettleTimeoutMs,
      })
      .catch((e) => {
        this.logger({
          category: "extract",
          message: "error extracting",
          level: 1,
          auxiliary: {
            error: {
              value: e.message,
              type: "string",
            },
            trace: {
              value: e.stack,
              type: "string",
            },
          },
        });

        if (this.enableCaching) {
          this.llmProvider.cleanRequestCache(requestId);
        }

        throw e;
      });
  }

  async observe(options?: ObserveOptions): Promise<ObserveResult[]> {
    if (!this.observeHandler) {
      throw new Error("Observe handler not initialized");
    }

    const requestId = Math.random().toString(36).substring(2);
    const llmClient = options?.modelName
      ? this.llmProvider.getClient(
          options.modelName,
          options.modelClientOptions,
        )
      : this.llmClient;

    this.logger({
      category: "observe",
      message: "running observe",
      level: 1,
      auxiliary: {
        instruction: {
          value: options?.instruction,
          type: "string",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
        modelName: {
          value: llmClient.modelName,
          type: "string",
        },
      },
    });

    return this.observeHandler
      .observe({
        instruction:
          options?.instruction ??
          "Find actions that can be performed on this page.",
        llmClient,
        useVision: options?.useVision ?? false,
        fullPage: false,
        requestId,
        domSettleTimeoutMs: options?.domSettleTimeoutMs,
      })
      .catch((e) => {
        this.logger({
          category: "observe",
          message: "error observing",
          level: 1,
          auxiliary: {
            error: {
              value: e.message,
              type: "string",
            },
            trace: {
              value: e.stack,
              type: "string",
            },
            requestId: {
              value: requestId,
              type: "string",
            },
            instruction: {
              value: options?.instruction,
              type: "string",
            },
          },
        });

        if (this.enableCaching) {
          this.llmProvider.cleanRequestCache(requestId);
        }

        throw e;
      });
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
