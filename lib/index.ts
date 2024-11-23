import { type Page, type BrowserContext, chromium } from "@playwright/test";
import { z } from "zod";
import fs from "fs";
import { Browserbase } from "@browserbasehq/sdk";
import { extract, observe } from "./inference";
import { AvailableModel, LLMProvider } from "./llm/LLMProvider";
import path from "path";
import { ScreenshotService } from "./vision";
import { LLMClient, modelsWithVision } from "./llm/LLMClient";
import { StagehandActHandler } from "./handlers/actHandler";
import { generateId } from "./utils";
// @ts-ignore we're using a built js file as a string here
import { scriptContent } from "./dom/build/scriptContent";
import { LogLine } from "./types";
import { randomUUID } from "crypto";
import { logLineToString } from "./utils";
import { resolveLLMClient } from "./llm/LLMProvider";

require("dotenv").config({ path: ".env" });

async function getBrowser(
  apiKey: string | undefined,
  projectId: string | undefined,
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: LogLine) => void,
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams,
  browserbaseResumeSessionID?: string,
) {
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

    const tmpDir = fs.mkdtempSync(`/tmp/pwtest`);
    fs.mkdirSync(`${tmpDir}/userdir/Default`, { recursive: true });

    const defaultPreferences = {
      plugins: {
        always_open_pdf_externally: true,
      },
    };

    fs.writeFileSync(
      `${tmpDir}/userdir/Default/Preferences`,
      JSON.stringify(defaultPreferences),
    );

    const downloadsPath = `${process.cwd()}/downloads`;
    fs.mkdirSync(downloadsPath, { recursive: true });

    const context = await chromium.launchPersistentContext(
      `${tmpDir}/userdir`,
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

    return { context };
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
  private llmClient?: LLMClient;
  private llmProvider: LLMProvider;
  private observations: {
    [key: string]: {
      result: { selector: string; description: string }[];
      instruction: string;
    };
  };
  public page: Page;
  public context: BrowserContext;
  private env: "LOCAL" | "BROWSERBASE";
  private apiKey: string | undefined;
  private projectId: string | undefined;
  private verbose: 0 | 1 | 2;
  private debugDom: boolean;
  private defaultModelName: AvailableModel;
  private headless: boolean;
  private logger: (logLine: LogLine) => void;
  private externalLogger?: (logLine: LogLine) => void;
  private domSettleTimeoutMs: number;
  private browserBaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  private enableCaching: boolean;
  private variables: { [key: string]: any };
  private actHandler: StagehandActHandler;
  private browserbaseResumeSessionID?: string;

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
    }: {
      env: "LOCAL" | "BROWSERBASE";
      apiKey?: string;
      projectId?: string;
      verbose?: 0 | 1 | 2;
      debugDom?: boolean;
      llmProvider?: LLMProvider;
      headless?: boolean;
      logger?: (message: LogLine) => void;
      domSettleTimeoutMs?: number;
      browserBaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
      enableCaching?: boolean;
      browserbaseResumeSessionID?: string;
    } = {
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
    this.observations = {};
    this.apiKey = apiKey ?? process.env.BROWSERBASE_API_KEY;
    this.projectId = projectId ?? process.env.BROWSERBASE_PROJECT_ID;
    this.verbose = verbose ?? 0;
    this.debugDom = debugDom ?? false;
    this.defaultModelName = "gpt-4o";
    this.domSettleTimeoutMs = domSettleTimeoutMs ?? 30_000;
    this.headless = headless ?? false;
    this.browserBaseSessionCreateParams = browserBaseSessionCreateParams;
    this.actHandler = new StagehandActHandler({
      stagehand: this,
      verbose: this.verbose,
      llmProvider: this.llmProvider,
      enableCaching: this.enableCaching,
      logger: this.logger,
      waitForSettledDom: this._waitForSettledDom.bind(this),
      defaultModelName: this.defaultModelName,
      startDomDebug: this.startDomDebug.bind(this),
      cleanupDomDebug: this.cleanupDomDebug.bind(this),
    });
    this.browserbaseResumeSessionID = browserbaseResumeSessionID;
  }

  async init({
    modelName = "gpt-4o",
    domSettleTimeoutMs,
  }: {
    modelName?: AvailableModel;
    domSettleTimeoutMs?: number;
  } = {}): Promise<{
    debugUrl: string;
    sessionUrl: string;
  }> {
    const { context, debugUrl, sessionUrl } = await getBrowser(
      this.apiKey,
      this.projectId,
      this.env,
      this.headless,
      this.logger,
      this.browserBaseSessionCreateParams,
      this.browserbaseResumeSessionID,
    ).catch((e) => {
      console.error("Error in init:", e);
      return { context: undefined, debugUrl: undefined, sessionUrl: undefined };
    });
    this.context = context;
    this.page = context.pages()[0];
    // Redundant but needed for users who are re-connecting to a previously-created session
    await this.page.waitForLoadState("domcontentloaded");
    await this._waitForSettledDom();

    this.defaultModelName = modelName;
    this.domSettleTimeoutMs = domSettleTimeoutMs ?? this.domSettleTimeoutMs;

    // Overload the page.goto method
    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, options);
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

    return { debugUrl, sessionUrl };
  }

  async initFromPage(
    page: Page,
    modelName?: AvailableModel,
  ): Promise<{ context: BrowserContext }> {
    this.page = page;
    this.context = page.context();
    this.defaultModelName = modelName || this.defaultModelName;

    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, options);
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

  // Logging
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

  private async _recordObservation(
    instruction: string,
    result: { selector: string; description: string }[],
  ): Promise<string> {
    const id = generateId(instruction);

    this.observations[id] = { result, instruction };

    return id;
  }

  // Main methods

  private async _extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    progress = "",
    content = {},
    chunksSeen = [],
    llmClient,
    modelName,
    requestId,
    domSettleTimeoutMs,
  }: {
    instruction: string;
    schema: T;
    progress?: string;
    content?: z.infer<T>;
    chunksSeen?: Array<number>;
    llmClient?: LLMClient;
    modelName?: AvailableModel;
    requestId?: string;
    domSettleTimeoutMs?: number;
  }): Promise<z.infer<T>> {
    this.log({
      category: "extraction",
      message: "starting extraction",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
      },
    });

    await this._waitForSettledDom(domSettleTimeoutMs);
    await this.startDomDebug();
    const { outputString, chunk, chunks } = await this.page.evaluate(
      (chunksSeen?: number[]) => window.processDom(chunksSeen ?? []),
      chunksSeen,
    );

    this.log({
      category: "extraction",
      message: "received output from processDom.",
      level: 1,
      auxiliary: {
        chunk: {
          value: chunk.toString(),
          type: "integer",
        },
        chunks_left: {
          value: (chunks.length - chunksSeen.length).toString(),
          type: "integer",
        },
        chunks_total: {
          value: chunks.length.toString(),
          type: "integer",
        },
      },
    });

    const extractionResponse = await extract({
      instruction,
      progress,
      previouslyExtractedContent: content,
      domElements: outputString,
      llmProvider: this.llmProvider,
      schema,
      llmClient: llmClient,
      modelName: modelName || this.defaultModelName,
      chunksSeen: chunksSeen.length,
      chunksTotal: chunks.length,
      requestId,
    });

    const {
      metadata: { progress: newProgress, completed },
      ...output
    } = extractionResponse;
    await this.cleanupDomDebug();

    this.log({
      category: "extraction",
      message: "received extraction response",
      level: 1,
      auxiliary: {
        extraction_response: {
          value: JSON.stringify(extractionResponse),
          type: "object",
        },
      },
    });

    chunksSeen.push(chunk);

    if (completed || chunksSeen.length === chunks.length) {
      this.log({
        category: "extraction",
        message: "got response",
        level: 1,
        auxiliary: {
          extraction_response: {
            value: JSON.stringify(extractionResponse),
            type: "object",
          },
        },
      });

      return output;
    } else {
      this.log({
        category: "extraction",
        message: "continuing extraction",
        level: 1,
        auxiliary: {
          extraction_response: {
            value: JSON.stringify(extractionResponse),
            type: "object",
          },
        },
      });
      await this._waitForSettledDom(domSettleTimeoutMs);
      return this._extract({
        instruction,
        schema,
        progress: newProgress,
        content: output,
        chunksSeen,
        llmClient,
        modelName,
        requestId,
        domSettleTimeoutMs,
      });
    }
  }

  private async _observe({
    instruction,
    useVision,
    fullPage,
    llmClient,
    modelName,
    requestId,
    domSettleTimeoutMs,
  }: {
    instruction: string;
    useVision: boolean;
    fullPage: boolean;
    llmClient?: LLMClient;
    modelName?: AvailableModel;
    requestId?: string;
    domSettleTimeoutMs?: number;
  }): Promise<{ selector: string; description: string }[]> {
    if (!instruction) {
      instruction = `Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.`;
    }

    const model = modelName ?? this.defaultModelName;

    this.log({
      category: "observation",
      message: "starting observation",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
      },
    });

    await this._waitForSettledDom(domSettleTimeoutMs);
    await this.startDomDebug();
    let { outputString, selectorMap } = await this.page.evaluate(
      (fullPage: boolean) =>
        fullPage ? window.processAllOfDom() : window.processDom([]),
      fullPage,
    );

    let annotatedScreenshot: Buffer | undefined;
    if (useVision === true) {
      if (!modelsWithVision.includes(model)) {
        this.log({
          category: "observation",
          message: "Model does not support vision. Skipping vision processing.",
          level: 1,
          auxiliary: {
            model: {
              value: model,
              type: "string",
            },
          },
        });
      } else {
        const screenshotService = new ScreenshotService(
          this.page,
          selectorMap,
          this.verbose,
          this.externalLogger,
        );

        annotatedScreenshot =
          await screenshotService.getAnnotatedScreenshot(fullPage);
        outputString = "n/a. use the image to find the elements.";
      }
    }

    const observationResponse = await observe({
      instruction,
      domElements: outputString,
      llmProvider: this.llmProvider,
      llmClient: llmClient,
      modelName: modelName || this.defaultModelName,
      image: annotatedScreenshot,
      requestId,
    });

    const elementsWithSelectors = observationResponse.elements.map(
      (element) => {
        const { elementId, ...rest } = element;

        return {
          ...rest,
          selector: `xpath=${selectorMap[elementId][0]}`,
        };
      },
    );

    await this.cleanupDomDebug();

    this._recordObservation(instruction, elementsWithSelectors);

    this.log({
      category: "observation",
      message: "found elements",
      level: 1,
      auxiliary: {
        elements: {
          value: JSON.stringify(elementsWithSelectors),
          type: "object",
        },
      },
    });

    await this._recordObservation(instruction, elementsWithSelectors);
    return elementsWithSelectors;
  }

  async act({
    action,
    llmClient: initllmClient,
    modelName,
    useVision = "fallback",
    variables = {},
    domSettleTimeoutMs,
  }: {
    action: string;
    llmClient?: LLMClient;
    modelName?: AvailableModel;
    useVision?: "fallback" | boolean;
    variables?: Record<string, string>;
    domSettleTimeoutMs?: number;
  }): Promise<{
    success: boolean;
    message: string;
    action: string;
  }> {
    useVision = useVision ?? "fallback";

    const requestId = Math.random().toString(36).substring(2);

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
      },
    });

    if (variables) {
      this.variables = { ...this.variables, ...variables };
    }

    const llmClient =
      initllmClient ||
      resolveLLMClient({
        modelName: modelName || this.defaultModelName,
        llmProvider: this.llmProvider,
        requestId,
      });

    return this.actHandler
      .act({
        action,
        llmClient,
        modelName,
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
    llmClient: initllmClient,
    modelName,
    domSettleTimeoutMs,
  }: {
    instruction: string;
    schema: T;
    llmClient?: LLMClient;
    modelName?: AvailableModel;
    domSettleTimeoutMs?: number;
  }): Promise<z.infer<T>> {
    const requestId = Math.random().toString(36).substring(2);

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
      },
    });

    const llmClient =
      initllmClient ||
      resolveLLMClient({
        modelName: modelName || this.defaultModelName,
        llmProvider: this.llmProvider,
        requestId,
      });

    return this._extract({
      instruction,
      schema,
      llmClient,
      modelName,
      requestId,
      domSettleTimeoutMs,
    }).catch((e) => {
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

  async observe({
    instruction = "Find actions that can be performed on this page.",
    llmClient: initllmClient,
    modelName,
    useVision = false,
    domSettleTimeoutMs,
  }: {
    instruction?: string;
    llmClient?: LLMClient;
    modelName?: AvailableModel;
    useVision?: boolean;
    domSettleTimeoutMs?: number;
  } = {}): Promise<{ selector: string; description: string }[]> {
    const requestId = Math.random().toString(36).substring(2);

    this.logger({
      category: "observe",
      message: "running observe",
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
      },
    });

    const llmClient =
      initllmClient ||
      resolveLLMClient({
        modelName: modelName || this.defaultModelName,
        llmProvider: this.llmProvider,
        requestId,
      });

    return this._observe({
      instruction,
      llmClient,
      modelName,
      useVision,
      fullPage: false,
      requestId,
      domSettleTimeoutMs,
    }).catch((e) => {
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
            value: instruction,
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
}
