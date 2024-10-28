import { type Page, type BrowserContext, chromium } from "@playwright/test";
import { expect } from "@playwright/test";
import crypto from "crypto";
import { z } from "zod";
import fs from "fs";
import { act, ask, extract, observe, verifyActCompletion } from "./inference";
import { AvailableModel, LLMProvider } from "./llm/LLMProvider";
import path from "path";
import Browserbase from "./browserbase";
import { ScreenshotService } from "./vision";
import { modelsWithVision } from "./llm/LLMClient";

require("dotenv").config({ path: ".env" });

async function getBrowser(
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: {
    category?: string;
    message: string;
    level?: 0 | 1 | 2;
  }) => void,
) {
  if (env === "BROWSERBASE" && !process.env.BROWSERBASE_API_KEY) {
    logger({
      category: "Init",
      message:
        "BROWSERBASE_API_KEY is required to use BROWSERBASE env. Defaulting to LOCAL.",
      level: 0,
    });
    env = "LOCAL";
  }

  if (env === "BROWSERBASE" && !process.env.BROWSERBASE_PROJECT_ID) {
    logger({
      category: "Init",
      message:
        "BROWSERBASE_PROJECT_ID is required to use BROWSERBASE env. Defaulting to LOCAL.",
      level: 0,
    });
    env = "LOCAL";
  }

  if (env === "BROWSERBASE") {
    let debugUrl: string | undefined = undefined;
    let sessionUrl: string | undefined = undefined;

    logger({
      category: "Init",
      message: "Connecting you to Browserbase...",
      level: 0,
    });
    const browserbase = new Browserbase();
    const { sessionId } = await browserbase.createSession();
    const browser = await chromium.connectOverCDP(
      `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${sessionId}`,
    );

    debugUrl = await browserbase.retrieveDebugConnectionURL(sessionId);
    sessionUrl = `https://www.browserbase.com/sessions/${sessionId}`;
    logger({
      category: "Init",
      message: `Browserbase session started.\n\nSession Url: ${sessionUrl}\n\nLive debug accessible here: ${debugUrl}.`,
      level: 0,
    });

    const context = browser.contexts()[0];

    return { browser, context, debugUrl, sessionUrl };
  } else {
    logger({
      category: "Init",
      message: `Launching local browser in ${headless ? "headless" : "headed"} mode`,
      level: 0,
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
        userDataDir: "./user_data",
      },
    );

    logger({
      category: "Init",
      message: "Local browser started successfully.",
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
  private llmProvider: LLMProvider;
  private observations: {
    [key: string]: { result: string; observation: string };
  };
  private actions: { [key: string]: { result: string; action: string } };
  private id: string;
  public page: Page;
  public context: BrowserContext;
  private env: "LOCAL" | "BROWSERBASE";
  private verbose: 0 | 1 | 2;
  private debugDom: boolean;
  private defaultModelName: AvailableModel;
  private headless: boolean;
  private logger: (message: { category?: string; message: string }) => void;
  private externalLogger?: (message: {
    category?: string;
    message: string;
  }) => void;

  constructor(
    {
      env,
      verbose = 0,
      debugDom = false,
      llmProvider,
      headless = false,
      logger,
    }: {
      env: "LOCAL" | "BROWSERBASE";
      verbose?: 0 | 1 | 2;
      debugDom?: boolean;
      llmProvider?: LLMProvider;
      headless?: boolean;
      logger?: (message: {
        category?: string;
        message: string;
        level?: 0 | 1 | 2;
      }) => void;
    } = {
      env: "BROWSERBASE",
    },
  ) {
    this.externalLogger = logger;
    this.logger = this.log.bind(this);
    this.llmProvider = llmProvider || new LLMProvider(this.logger);
    this.env = env;
    this.observations = {};
    this.actions = {};
    this.verbose = verbose;
    this.debugDom = debugDom;
    this.defaultModelName = "gpt-4o";
    this.headless = headless;
  }

  async init({
    modelName = "gpt-4o",
  }: { modelName?: AvailableModel } = {}): Promise<{
    debugUrl: string;
    sessionUrl: string;
  }> {
    const { context, debugUrl, sessionUrl } = await getBrowser(
      this.env,
      this.headless,
      this.logger,
    ).catch((e) => {
      console.error("Error in init:", e);
      return { context: undefined, debugUrl: undefined, sessionUrl: undefined };
    });
    this.context = context;
    this.page = context.pages()[0];
    this.defaultModelName = modelName;

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

    // This can be greatly improved, but the tldr is we put our built web scripts in dist, which should always
    // be one level above our running directly across evals, example, and as a package
    await this.page.addInitScript({
      path: path.join(__dirname, "..", "dist", "dom", "build", "process.js"),
    });

    await this.page.addInitScript({
      path: path.join(__dirname, "..", "dist", "dom", "build", "utils.js"),
    });

    await this.page.addInitScript({
      path: path.join(__dirname, "..", "dist", "dom", "build", "debug.js"),
    });

    return { debugUrl, sessionUrl };
  }

  // Logging
  private pending_logs_to_send_to_browserbase: {
    category?: string;
    message: string;
    level?: 0 | 1 | 2;
    id: string;
  }[] = [];

  private is_processing_browserbase_logs: boolean = false;

  log(logObj: { category?: string; message: string; level?: 0 | 1 | 2 }): void {
    logObj.level = logObj.level || 1;

    // Normal Logging
    if (this.externalLogger) {
      this.externalLogger(logObj);
    } else {
      const categoryString = logObj.category ? `:${logObj.category}` : "";
      const logMessage = `[stagehand${categoryString}] ${logObj.message}`;
      console.log(logMessage);
    }

    // Add the logs to the browserbase session
    this.pending_logs_to_send_to_browserbase.push({
      ...logObj,
      id: Math.random().toString(36).substring(2, 15),
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

  private async _log_to_browserbase(logObj: {
    category?: string;
    message: string;
    level?: 0 | 1 | 2;
    id: string;
  }) {
    logObj.level = logObj.level || 1;

    if (!this.page) {
      return;
    }

    if (this.verbose >= logObj.level) {
      await this.page
        .evaluate((logObj) => {
          const logMessage = `[stagehand${logObj.category ? `:${logObj.category}` : ""}] ${logObj.message}`;
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

  private async _waitForSettledDom() {
    try {
      await this.page.waitForSelector("body");
      await this.page.waitForLoadState("domcontentloaded");

      await this.page.evaluate(() => {
        return new Promise<void>((resolve) => {
          if (typeof window.waitForDomSettle === "function") {
            window.waitForDomSettle().then(() => {
              resolve();
            });
          } else {
            console.warn(
              "waitForDomSettle is not defined, considering DOM as settled",
            );
            resolve();
          }
        });
      });
    } catch (e) {
      this.log({
        category: "dom",
        message: `Error in waitForSettledDom: ${e.message}\nTrace: ${e.stack}`,
        level: 1,
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
        message: `Error in startDomDebug: ${e.message}\nTrace: ${e.stack}`,
        level: 1,
      });
    }
  }

  private async cleanupDomDebug() {
    if (this.debugDom) {
      await this.page.evaluate(() => window.cleanupDebug()).catch(() => {});
    }
  }

  // Recording
  private _generateId(operation: string) {
    return crypto.createHash("sha256").update(operation).digest("hex");
  }

  private async _recordObservation(
    observation: string,
    result: string,
  ): Promise<string> {
    const id = this._generateId(observation);

    this.observations[id] = { result, observation };

    return id;
  }

  private async _recordAction(action: string, result: string): Promise<string> {
    const id = this._generateId(action);

    this.actions[id] = { result, action };

    return id;
  }

  // Main methods

  private async _extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    progress = "",
    content = {},
    chunksSeen = [],
    modelName,
  }: {
    instruction: string;
    schema: T;
    progress?: string;
    content?: z.infer<T>;
    chunksSeen?: Array<number>;
    modelName?: AvailableModel;
  }): Promise<z.infer<T>> {
    this.log({
      category: "extraction",
      message: `starting extraction '${instruction}'`,
      level: 1,
    });

    await this._waitForSettledDom();
    await this.startDomDebug();
    const { outputString, chunk, chunks } = await this.page.evaluate(
      (chunksSeen?: number[]) => window.processDom(chunksSeen ?? []),
      chunksSeen,
    );

    this.log({
      category: "extraction",
      message: `received output from processDom. Current chunk index: ${chunk}, Number of chunks left: ${chunks.length - chunksSeen.length}`,
      level: 1,
    });

    const extractionResponse = await extract({
      instruction,
      progress,
      previouslyExtractedContent: content,
      domElements: outputString,
      llmProvider: this.llmProvider,
      schema,
      modelName: modelName || this.defaultModelName,
      chunksSeen: chunksSeen.length,
      chunksTotal: chunks.length,
    });

    const {
      metadata: { progress: newProgress, completed },
      ...output
    } = extractionResponse;
    await this.cleanupDomDebug();

    this.log({
      category: "extraction",
      message: `received extraction response: ${JSON.stringify(extractionResponse)}`,
      level: 1,
    });

    chunksSeen.push(chunk);

    if (completed || chunksSeen.length === chunks.length) {
      this.log({
        category: "extraction",
        message: `response: ${JSON.stringify(extractionResponse)}`,
        level: 1,
      });

      return output;
    } else {
      this.log({
        category: "extraction",
        message: `continuing extraction, progress: '${newProgress}'`,
        level: 1,
      });
      await this._waitForSettledDom();
      return this._extract({
        instruction,
        schema,
        progress: newProgress,
        content: output,
        chunksSeen,
        modelName,
      });
    }
  }

  private async _observe({
    observation,
    modelName,
  }: {
    observation: string;
    modelName?: AvailableModel;
  }): Promise<string | null> {
    this.log({
      category: "observation",
      message: `starting observation: ${observation}`,
      level: 1,
    });

    await this._waitForSettledDom();
    await this.startDomDebug();
    const { outputString, selectorMap } = await this.page.evaluate(() =>
      window.processDom([]),
    );

    const elementId = await observe({
      observation,
      domElements: outputString,
      llmProvider: this.llmProvider,
      modelName: modelName || this.defaultModelName,
    });

    await this.cleanupDomDebug();

    if (elementId === "NONE") {
      this.log({
        category: "observation",
        message: `no element found for ${observation}`,
        level: 1,
      });
      return null;
    }

    this.log({
      category: "observation",
      message: `found element ${elementId}`,
      level: 1,
    });

    const selector = selectorMap[parseInt(elementId)];
    const locatorString = `xpath=${selector}`;

    this.log({
      category: "observation",
      message: `found locator ${locatorString}`,
      level: 1,
    });

    // the locator string found by the LLM might resolve to multiple places in the DOM
    const firstLocator = this.page.locator(locatorString).first();

    await expect(firstLocator).toBeAttached();
    const observationId = await this._recordObservation(
      observation,
      locatorString,
    );

    return observationId;
  }

  private async _act({
    action,
    steps = "",
    chunksSeen,
    modelName,
    useVision,
    verifierUseVision,
    retries = 0,
  }: {
    action: string;
    steps?: string;
    chunksSeen: number[];
    modelName?: AvailableModel;
    useVision: boolean | "fallback";
    verifierUseVision: boolean;
    retries?: number;
  }): Promise<{ success: boolean; message: string; action: string }> {
    const model = modelName ?? this.defaultModelName;

    if (
      !modelsWithVision.includes(model) &&
      (useVision !== false || verifierUseVision)
    ) {
      this.log({
        category: "action",
        message: `${model} does not support vision, but useVision was set to ${useVision}. Defaulting to false.`,
        level: 1,
      });
      useVision = false;
      verifierUseVision = false;
    }

    this.log({
      category: "action",
      message: `Running / Continuing action: ${action} on page: ${this.page.url()}`,
      level: 2,
    });

    await this._waitForSettledDom();

    await this.startDomDebug();

    this.log({
      category: "action",
      message: `Processing DOM...`,
      level: 2,
    });

    const { outputString, selectorMap, chunk, chunks } =
      await this.page.evaluate(
        ({ chunksSeen }: { chunksSeen: number[] }) => {
          // @ts-ignore
          return window.processDom(chunksSeen);
        },
        { chunksSeen },
      );

    this.log({
      category: "action",
      message: `Looking at chunk ${chunk}. Chunks left: ${
        chunks.length - chunksSeen.length
      }`,
      level: 1,
    });

    // Prepare annotated screenshot if vision is enabled
    let annotatedScreenshot: Buffer | undefined;
    if (useVision === true) {
      if (!modelsWithVision.includes(model)) {
        this.log({
          category: "action",
          message: `${model} does not support vision. Skipping vision processing.`,
          level: 1,
        });
      } else {
        const screenshotService = new ScreenshotService(
          this.page,
          selectorMap,
          this.verbose,
        );

        annotatedScreenshot =
          await screenshotService.getAnnotatedScreenshot(false);
      }
    }

    const response = await act({
      action,
      domElements: outputString,
      steps,
      llmProvider: this.llmProvider,
      modelName: model,
      screenshot: annotatedScreenshot,
      logger: this.logger,
    });

    this.log({
      category: "action",
      message: `Received response from LLM: ${JSON.stringify(response)}`,
      level: 1,
    });

    await this.cleanupDomDebug();

    if (!response) {
      if (chunksSeen.length + 1 < chunks.length) {
        chunksSeen.push(chunk);

        this.log({
          category: "action",
          message: `No action found in current chunk. Chunks seen: ${chunksSeen.length}.`,
          level: 1,
        });

        return this._act({
          action,
          steps:
            steps +
            (!steps.endsWith("\n") ? "\n" : "") +
            "## Step: Scrolled to another section\n",
          chunksSeen,
          modelName,
          useVision,
          verifierUseVision,
        });
      } else if (useVision === "fallback") {
        this.log({
          category: "action",
          message: `Switching to vision-based processing`,
          level: 1,
        });
        await this.page.evaluate(() => window.scrollToHeight(0));
        return await this._act({
          action,
          steps,
          chunksSeen,
          modelName,
          useVision: true,
          verifierUseVision,
        });
      } else {
        return {
          success: false,
          message: `Action was not able to be completed.`,
          action: action,
        };
      }
    }

    // Action found, proceed to execute
    const elementId = response["element"];
    const xpath = selectorMap[elementId];
    const method = response["method"];
    const args = response["args"];

    // Get the element text from the outputString
    const elementLines = outputString.split("\n");
    const elementText =
      elementLines
        .find((line) => line.startsWith(`${elementId}:`))
        ?.split(":")[1] || "Element not found";

    this.log({
      category: "action",
      message: `Executing method: ${method} on element: ${elementId} (xpath: ${xpath}) with args: ${JSON.stringify(
        args,
      )}`,
      level: 1,
    });

    let urlChangeString = "";

    const locator = this.page.locator(`xpath=${xpath}`).first();
    try {
      const initialUrl = this.page.url();
      if (method === "scrollIntoView") {
        this.log({
          category: "action",
          message: `Scrolling element into view`,
          level: 2,
        });
        try {
          await locator
            .evaluate((element) => {
              element.scrollIntoView({ behavior: "smooth", block: "center" });
            })
            .catch((e: Error) => {
              this.log({
                category: "action",
                message: `Error scrolling element into view: ${e.message}\nTrace: ${e.stack}`,
                level: 1,
              });
            });
        } catch (e) {
          this.log({
            category: "action",
            message: `Error scrolling element into view (Retries ${retries}): ${e.message}\nTrace: ${e.stack}`,
            level: 1,
          });

          if (retries < 2) {
            return this._act({
              action,
              steps,
              modelName,
              useVision,
              verifierUseVision,
              retries: retries + 1,
              chunksSeen,
            });
          }
        }
      } else if (method === "fill" || method === "type") {
        try {
          await locator.fill("");
          await locator.click();
          const text = args[0];
          for (const char of text) {
            await this.page.keyboard.type(char, {
              delay: Math.random() * 50 + 25,
            });
          }
        } catch (e) {
          this.log({
            category: "action",
            message: `Error filling element (Retries ${retries}): ${e.message}\nTrace: ${e.stack}`,
            level: 1,
          });

          if (retries < 2) {
            return this._act({
              action,
              steps,
              modelName,
              useVision,
              verifierUseVision,
              retries: retries + 1,
              chunksSeen,
            });
          }
        }
      } else if (
        typeof locator[method as keyof typeof locator] === "function"
      ) {
        // Log current URL before action
        this.log({
          category: "action",
          message: `Page URL before action: ${this.page.url()}`,
          level: 2,
        });

        // Perform the action
        try {
          // @ts-ignore
          await locator[method](...args);
        } catch (e) {
          this.log({
            category: "action",
            message: `Error performing method ${method} with args ${JSON.stringify(
              args,
            )} (Retries: ${retries}): ${e.message}\nTrace: ${e.stack}`,
            level: 1,
          });

          if (retries < 2) {
            return this._act({
              action,
              steps,
              modelName,
              useVision,
              verifierUseVision,
              retries: retries + 1,
              chunksSeen,
            });
          }
        }

        // Handle navigation if a new page is opened
        if (method === "click") {
          this.log({
            category: "action",
            message: `Clicking element, checking for page navigation`,
            level: 1,
          });

          // NAVIDNOTE: Should this happen before we wait for locator[method]?
          const newOpenedTab = await Promise.race([
            new Promise<Page | null>((resolve) => {
              this.context.once("page", (page) => resolve(page));
              setTimeout(() => resolve(null), 1_500);
            }),
          ]);

          this.log({
            category: "action",
            message: `Clicked element, ${
              newOpenedTab ? "opened a new tab" : "no new tabs opened"
            }`,
            level: 1,
          });

          if (newOpenedTab) {
            this.log({
              category: "action",
              message: `New page detected (new tab) with URL: ${newOpenedTab.url()}`,
              level: 1,
            });
            await newOpenedTab.close();
            await this.page.goto(newOpenedTab.url());
            await this.page.waitForLoadState("domcontentloaded");
            await this._waitForSettledDom();
          }

          // Wait for the network to be idle with timeout of 5s (will only wait if loading a new page)
          // await this.waitForSettledDom();
          await Promise.race([
            this.page.waitForLoadState("networkidle"),
            new Promise((resolve) => setTimeout(resolve, 5_000)),
          ]).catch((e: Error) => {
            this.log({
              category: "action",
              message: `Network idle timeout hit`,
              level: 1,
            });
          });

          this.log({
            category: "action",
            message: `Finished waiting for (possible) page navigation`,
            level: 1,
          });

          if (this.page.url() !== initialUrl) {
            this.log({
              category: "action",
              message: `New page detected with URL: ${this.page.url()}`,
              level: 1,
            });
          }
        }
      } else {
        this.log({
          category: "action",
          message: `Chosen method ${method} is invalid`,
          level: 1,
        });
        if (retries < 2) {
          return this._act({
            action,
            steps,
            modelName: model,
            useVision,
            verifierUseVision,
            retries: retries + 1,
            chunksSeen,
          });
        } else {
          return {
            success: false,
            message: `Internal error: Chosen method ${method} is invalid`,
            action: action,
          };
        }
      }

      let newSteps =
        steps +
        (!steps.endsWith("\n") ? "\n" : "") +
        `## Step: ${response.step}\n` +
        `  Element: ${elementText}\n` +
        `  Action: ${response.method}\n` +
        `  Reasoning: ${response.why}\n`;

      if (urlChangeString) {
        newSteps += `  Result (Important): ${urlChangeString}\n\n`;
      }

      let actionComplete = false;
      if (response.completed) {
        // Run action completion verifier
        this.log({
          category: "action",
          message: `Action marked as completed, Verifying if this is true...`,
          level: 1,
        });

        let domElements: string | undefined = undefined;
        let fullpageScreenshot: Buffer | undefined = undefined;

        if (verifierUseVision) {
          try {
            const screenshotService = new ScreenshotService(
              this.page,
              selectorMap,
              this.verbose,
            );

            fullpageScreenshot = await screenshotService.getScreenshot(
              true,
              15,
            );
          } catch (e) {
            this.log({
              category: "action",
              message: `Error getting full page screenshot: ${e.message}\n. Trying again...`,
              level: 1,
            });

            const screenshotService = new ScreenshotService(
              this.page,
              selectorMap,
              this.verbose,
            );

            fullpageScreenshot = await screenshotService.getScreenshot(
              true,
              15,
            );
          }
        } else {
          ({ outputString: domElements } = await this.page.evaluate(() => {
            return window.processAllOfDom();
          }));
        }

        actionComplete = await verifyActCompletion({
          goal: action,
          steps: newSteps,
          llmProvider: this.llmProvider,
          modelName: model,
          screenshot: fullpageScreenshot,
          domElements: domElements,
          logger: this.logger,
        });

        this.log({
          category: "action",
          message: `Action completion verification result: ${actionComplete}`,
          level: 1,
        });
      }

      if (!actionComplete) {
        this.log({
          category: "action",
          message: `Continuing to next action step`,
          level: 1,
        });
        return this._act({
          action,
          steps: newSteps,
          modelName,
          chunksSeen,
          useVision,
          verifierUseVision,
        });
      } else {
        this.log({
          category: "action",
          message: `Action completed successfully`,
          level: 1,
        });
        await this._recordAction(action, response.step);
        return {
          success: true,
          message: `Action completed successfully: ${steps}${response.step}`,
          action: action,
        };
      }
    } catch (error) {
      this.log({
        category: "action",
        message: `Error performing action (Retries: ${retries}): ${error.message}\nTrace: ${error.stack}`,
        level: 1,
      });
      if (retries < 2) {
        return this._act({
          action,
          steps,
          modelName,
          useVision,
          verifierUseVision,
          retries: retries + 1,
          chunksSeen,
        });
      }

      await this._recordAction(action, "");
      return {
        success: false,
        message: `Error performing action: ${error.message}`,
        action: action,
      };
    }
  }

  async act({
    action,
    modelName,
    useVision = "fallback",
  }: {
    action: string;
    modelName?: AvailableModel;
    useVision?: "fallback" | boolean;
  }): Promise<{
    success: boolean;
    message: string;
    action: string;
  }> {
    useVision = useVision ?? "fallback";

    return this._act({
      action,
      modelName,
      chunksSeen: [],
      useVision,
      verifierUseVision: useVision !== false,
    });
  }

  async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    modelName,
  }: {
    instruction: string;
    schema: T;
    modelName?: AvailableModel;
  }): Promise<z.infer<T>> {
    return this._extract({
      instruction,
      schema,
      modelName,
    });
  }

  async observe({
    observation,
    modelName,
  }: {
    observation: string;
    modelName?: AvailableModel;
  }): Promise<string | null> {
    return this._observe({ observation, modelName });
  }
}
