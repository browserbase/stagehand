import {
  type Page,
  type BrowserContext,
  chromium,
  Frame,
} from "@playwright/test";
import { expect } from "@playwright/test";
import crypto from "crypto";
import { z } from "zod";
import fs from "fs";
import { act, ask, extract, observe, verifyActCompletion } from "./inference";
import { LLMProvider } from "./llm/LLMProvider";
import path from "path";
import Browserbase from "./browserbase";
import { ScreenshotService } from "./vision";
import { modelsWithVision } from "./llm/LLMClient";

require("dotenv").config({ path: ".env" });

async function getBrowser(
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
) {
  if (env === "BROWSERBASE" && !process.env.BROWSERBASE_API_KEY) {
    console.error(
      "BROWSERBASE_API_KEY is required to use BROWSERBASE env. Defaulting to LOCAL.",
    );
    env = "LOCAL";
  }

  if (env === "BROWSERBASE" && !process.env.BROWSERBASE_PROJECT_ID) {
    console.error(
      "BROWSERBASE_PROJECT_ID is required to use BROWSERBASE env. Defaulting to LOCAL.",
    );
    env = "LOCAL";
  }

  let debugUrl: string | undefined = undefined;
  if (env === "BROWSERBASE") {
    console.log("Connecting you to Browserbase...");
    const browserbase = new Browserbase();
    const { sessionId } = await browserbase.createSession();
    const browser = await chromium.connectOverCDP(
      `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${sessionId}`,
    );

    debugUrl = await browserbase.retrieveDebugConnectionURL(sessionId);
    console.log(
      `Browserbase session started, live debug accessible here: ${debugUrl}.`,
    );

    const context = browser.contexts()[0];
    // Include debugUrl in the returned object
    return { browser, context, debugUrl };
  } else {
    if (!process.env.BROWSERBASE_API_KEY) {
      console.log("No Browserbase key detected");
      console.log("Starting a local browser...");
    }

    console.log(
      `Launching browser in ${headless ? "headless" : "headed"} mode`,
    );

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
        ],
        userDataDir: "./user_data",
      },
    );

    console.log("Local browser started successfully.");

    await applyStealthScripts(context);

    if (debugUrl) {
      return { context, debugUrl };
    } else {
      return { context };
    }
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
  public observations: {
    [key: string]: { result: string; observation: string };
  };
  private actions: { [key: string]: { result: string; action: string } };
  id: string;
  public page: Page;
  public context: BrowserContext;
  public env: "LOCAL" | "BROWSERBASE";
  public verbose: 0 | 1 | 2;
  public debugDom: boolean;
  public defaultModelName: string;
  public headless: boolean;
  public iframeSupport: boolean;
  private logger: (message: { category?: string; message: string }) => void;

  constructor(
    {
      env,
      verbose = 0,
      debugDom = false,
      llmProvider,
      headless = false,
      iframeSupport = false,
    }: {
      env: "LOCAL" | "BROWSERBASE";
      verbose?: 0 | 1 | 2;
      debugDom?: boolean;
      llmProvider?: LLMProvider;
      headless?: boolean;
      iframeSupport?: boolean;
    } = {
      env: "BROWSERBASE",
    },
  ) {
    this.logger = this.log.bind(this);
    this.llmProvider = llmProvider || new LLMProvider(this.logger);
    this.env = env;
    this.observations = {};
    this.actions = {};
    this.verbose = verbose;
    this.debugDom = debugDom;
    this.defaultModelName = "gpt-4o";
    this.headless = headless;
    this.iframeSupport = iframeSupport;
  }

  log({
    category,
    message,
    level = 1,
  }: {
    category?: string;
    message: string;
    level?: 0 | 1 | 2;
  }) {
    if (this.verbose >= level) {
      const categoryString = category ? `:${category}` : "";
      console.log(`[stagehand${categoryString}] ${message}`);
    }
  }

  async downloadPDF(url: string, title: string) {
    const downloadPromise = this.page.waitForEvent("download");
    await this.act({
      action: `click on ${url}`,
    });
    const download = await downloadPromise;
    await download.saveAs(`downloads/${title}.pdf`);
    await download.delete();
  }

  async init({ modelName = "gpt-4o" }: { modelName?: string } = {}) {
    const { context, debugUrl } = await getBrowser(this.env, this.headless);
    this.context = context;
    this.page = context.pages()[0];
    this.defaultModelName = modelName;

    // Overload the page.goto method
    const originalGoto = this.page.goto.bind(this.page);
    this.page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, options);
      await this.page.waitForLoadState("domcontentloaded");
      await this.waitForSettledDom();
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

    return { debugUrl };
  }

  async waitForSettledDom() {
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
        message: `Error in waitForSettledDom: ${e.message}`,
        level: 1,
      });
    }
  }

  async startDomDebug() {
    try {
      await this.page.evaluate(() => {
        if (typeof window.debugDom === "function") {
          window.debugDom();
        } else {
          console.warn("debugDom is not defined");
        }
      });
    } catch (e) {
      console.log("Error in startDomDebug:", e);
    }
  }
  async cleanupDomDebug() {
    if (this.debugDom) {
      await this.page.evaluate(() => window.cleanupDebug());
    }
  }
  getId(operation: string) {
    return crypto.createHash("sha256").update(operation).digest("hex");
  }

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
    modelName?: string;
  }): Promise<z.infer<T>> {
    this.log({
      category: "extraction",
      message: `starting extraction '${instruction}'`,
      level: 1,
    });

    await this.waitForSettledDom();
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
      await this.waitForSettledDom();
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

  async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    modelName,
  }: {
    instruction: string;
    schema: T;
    modelName?: string;
  }): Promise<z.infer<T>> {
    return this._extract({
      instruction,
      schema,
      modelName,
    });
  }

  async observe(
    observation: string,
    modelName?: string,
  ): Promise<string | null> {
    this.log({
      category: "observation",
      message: `starting observation: ${observation}`,
      level: 1,
    });

    await this.waitForSettledDom();
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
    const observationId = await this.recordObservation(
      observation,
      locatorString,
    );

    return observationId;
  }

  async ask(question: string, modelName?: string): Promise<string | null> {
    await this.waitForSettledDom();

    return ask({
      question,
      llmProvider: this.llmProvider,
      modelName: modelName || this.defaultModelName,
    });
  }

  async recordObservation(
    observation: string,
    result: string,
  ): Promise<string> {
    const id = this.getId(observation);

    this.observations[id] = { result, observation };

    return id;
  }

  async recordAction(action: string, result: string): Promise<string> {
    const id = this.getId(action);

    this.actions[id] = { result, action };

    return id;
  }

  private async _act({
    action,
    steps = "",
    frameIndex = 0,
    frames = [],
    chunksSeenPerFrame = {},
    visionAttemptedPerFrame = {},
    modelName,
    useVision,
    verifierUseVision,
    retries = 0,
  }: {
    action: string;
    steps?: string;
    frameIndex?: number;
    frames?: Frame[];
    chunksSeenPerFrame?: { [frameId: number]: number[] };
    visionAttemptedPerFrame?: { [frameId: number]: boolean };
    modelName?: string;
    useVision: boolean | "fallback";
    verifierUseVision: boolean;
    retries?: number;
  }): Promise<{ success: boolean; message: string; action: string }> {
    const model = modelName ?? this.defaultModelName;

    if (
      !modelsWithVision.includes(model) &&
      (useVision !== false || verifierUseVision)
    ) {
      console.warn(
        `${model} does not support vision, but useVision was set to ${useVision}. Defaulting to false.`,
      );
      useVision = false;
      verifierUseVision = false;
    }

    this.log({
      category: "action",
      message: `Starting action: ${action}`,
      level: 2,
    });

    await this.waitForSettledDom();

    // Initialize frames if not provided
    if (frames.length === 0) {
      // Collect top-level frames
      const mainFrame = this.page.mainFrame();
      frames = [mainFrame];

      if (this.iframeSupport) {
        const iframeElements = await this.page.$$("iframe");

        for (const iframeElement of iframeElements) {
          const src = await iframeElement.getAttribute("src");
          const isVisible = await iframeElement.isVisible();
          if (src && src.trim() !== "" && isVisible) {
            const frame = await iframeElement.contentFrame();
            if (frame) {
              frames.push(frame);
            }
          }
        }
      }

      // Initialize tracking objects for each frame
      chunksSeenPerFrame = {};
      visionAttemptedPerFrame = {};
      frames.forEach((_, index) => {
        chunksSeenPerFrame[index] = [];
        visionAttemptedPerFrame[index] = false;
      });
    }

    if (frameIndex >= frames.length) {
      this.log({
        category: "action",
        message: `Action not found in any frame`,
        level: 1,
      });
      await this.recordAction(action, "");
      return {
        success: false,
        message: `Action not found in any frame`,
        action: action,
      };
    }

    const currentFrame = frames[frameIndex];
    const frameId = frameIndex;
    const chunksSeen = chunksSeenPerFrame[frameId];

    await this.startDomDebug();

    const { outputString, selectorMap, chunk, chunks } =
      await currentFrame.evaluate(
        ({ chunksSeen }: { chunksSeen: number[] }) => {
          // @ts-ignore
          return window.processDom(chunksSeen);
        },
        { chunksSeen },
      );

    this.log({
      category: "action",
      message: `Processing frame ${frameIndex} (chunk ${chunk}). Chunks left: ${
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
          currentFrame,
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
    });

    this.log({
      category: "action",
      message: `Received response from LLM: ${JSON.stringify(response)}`,
      level: 1,
    });

    await this.cleanupDomDebug();

    chunksSeen.push(chunk);
    chunksSeenPerFrame[frameId] = chunksSeen;

    if (!response) {
      if (chunksSeen.length < chunks.length) {
        // Recursively process the next chunk in the same frame
        this.log({
          category: "action",
          message: `No action found in current chunk. Chunks seen: ${chunksSeen.length}. Moving to next chunk in frame ${frameIndex}`,
          level: 1,
        });
        return this._act({
          action,
          steps:
            steps +
            (!steps.endsWith("\n") ? "\n" : "") +
            "## Step: Scrolled to another section\n",
          frameIndex,
          frames,
          chunksSeenPerFrame,
          visionAttemptedPerFrame,
          modelName,
          useVision,
          verifierUseVision,
        });
      } else if (
        useVision === "fallback" &&
        !visionAttemptedPerFrame[frameId]
      ) {
        // Switch to vision-based processing in the same frame
        if (frameIndex === 0) {
          await this.page.evaluate(() => window.scrollToHeight(0));
        }

        this.log({
          category: "action",
          message: `Switching to vision-based processing in frame ${frameIndex}`,
          level: 1,
        });
        visionAttemptedPerFrame[frameId] = true;
        // **Reset chunksSeen for the frame where vision is attempted**
        chunksSeenPerFrame[frameId] = [];
        await this.page.evaluate(() => window.scrollToHeight(0));
        return await this._act({
          action,
          steps,
          frameIndex,
          frames,
          chunksSeenPerFrame,
          visionAttemptedPerFrame,
          modelName,
          useVision: true,
          verifierUseVision,
        });
      } else {
        // Move to the next frame
        this.log({
          category: "action",
          message: `No action found in frame ${frameIndex}. Moving to next frame.`,
          level: 1,
        });
        return await this._act({
          action,
          steps,
          frameIndex: frameIndex + 1,
          frames,
          chunksSeenPerFrame,
          visionAttemptedPerFrame,
          modelName,
          useVision,
          verifierUseVision,
        });
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
        await locator
          .evaluate((element) => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          })
          .catch(() => {
            this.log({
              category: "action",
              message: `Error scrolling element into view`,
              level: 1,
            });
          });
      } else if (method === "fill" || method === "type") {
        await locator.fill("");
        await locator.click();
        const text = args[0];
        for (const char of text) {
          await this.page.keyboard.type(char, {
            delay: Math.random() * 50 + 25,
          });
        }
      } else if (
        typeof locator[method as keyof typeof locator] === "function"
      ) {
        const isLink = await locator
          .evaluate((element) => {
            return (
              element.tagName.toLowerCase() === "a" &&
              element.hasAttribute("href")
            );
          })
          .catch(() => {
            this.log({
              category: "action",
              message: `Error checking if element is a link`,
              level: 1,
            });
            return false;
          });

        this.log({
          category: "action",
          message: `Element is a link: ${isLink}`,
          level: 2,
        });

        // Log current URL before action
        this.log({
          category: "action",
          message: `Current page URL before action: ${this.page.url()}`,
          level: 2,
        });

        // Perform the action
        // @ts-ignore
        await locator[method](...args);

        const finalUrl = this.page.url();
        if (finalUrl !== initialUrl) {
          urlChangeString = `Page url changed to ${finalUrl} after this step`;
        }

        // Log current URL after action
        this.log({
          category: "action",
          message: `Current page URL after action: ${this.page.url()}`,
          level: 2,
        });

        // Handle navigation if a new page is opened
        if (method === "click" && isLink) {
          this.log({
            category: "action",
            message: `Clicking link, checking for new page`,
            level: 1,
          });
          const newPagePromise = Promise.race([
            new Promise<Page | null>((resolve) => {
              this.context.once("page", (page) => resolve(page));
              setTimeout(() => resolve(null), 1500);
            }),
          ]);
          const newPage = await newPagePromise;
          if (newPage) {
            const newUrl = await newPage.url();
            this.log({
              category: "action",
              message: `New page detected with URL: ${newUrl}`,
              level: 1,
            });
            await newPage.close();
            await this.page.goto(newUrl);
            await this.page.waitForLoadState("domcontentloaded");
            await this.waitForSettledDom();
          } else {
            this.log({
              category: "action",
              message: `No new page opened after clicking link`,
              level: 1,
            });
            const newPagePromise = Promise.race([
              new Promise<Page | null>((resolve) => {
                this.context.once("page", (page) => resolve(page));
                setTimeout(() => resolve(null), 1500); // 1500ms timeout
              }),
            ]);
            const newPage = await newPagePromise;
            if (newPage) {
              const newUrl = await newPage.url();
              this.log({
                category: "action",
                message: `New page detected with URL: ${newUrl}`,
                level: 1,
              });
              await newPage.close();
              await this.page.goto(newUrl);
            } else {
              this.log({
                category: "action",
                message: `Clicking element, waiting for network to be idle`,
                level: 1,
              });

              // In case the click causes a navigation, wait for the network to be idle
              await this.page
                .waitForLoadState("networkidle", {
                  timeout: 5_000,
                })
                .catch(() => {
                  this.log({
                    category: "action",
                    message: `Network idle timeout`,
                    level: 1,
                  });
                });
            }
          }

          this.log({
            category: "action",
            message: `Navigation detected to URL: ${this.page.url()}`,
            level: 1,
          });
        }
      } else {
        this.log({
          category: "action",
          message: `Internal error: Chosen method ${method} is invalid`,
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

      let domElements: string | undefined = undefined;
      let fullpageScreenshot: Buffer | undefined = undefined;

      const frame = this.page.mainFrame() ?? this.page.frames()[0];
      const screenshotService = new ScreenshotService(
        frame,
        selectorMap,
        this.verbose,
      );

      if (verifierUseVision) {
        fullpageScreenshot = await screenshotService.getScreenshot(true, 15);
      } else {
        ({ outputString: domElements } = await this.page.evaluate(() => {
          return window.processAllOfDom();
        }));
      }

      const actionComplete = response.completed
        ? await verifyActCompletion({
            goal: action,
            steps: newSteps,
            llmProvider: this.llmProvider,
            modelName: model,
            screenshot: fullpageScreenshot,
            domElements: domElements,
          })
        : false;

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
          frameIndex,
          frames,
          chunksSeenPerFrame,
          visionAttemptedPerFrame,
          useVision,
          verifierUseVision,
        });
      } else {
        this.log({
          category: "action",
          message: `Action completed successfully`,
          level: 1,
        });
        await this.recordAction(action, response.step);
        return {
          success: true,
          message: `Action completed successfully: ${steps}${response.step}`,
          action: action,
        };
      }
    } catch (error) {
      console.trace(error);
      this.log({
        category: "action",
        message: `Error performing action: ${error.message}`,
        level: 1,
      });
      await this.recordAction(action, "");
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
    modelName?: string;
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
      useVision,
      verifierUseVision: useVision !== false,
    });
  }

  setPage(page: Page) {
    this.page = page;
  }

  setContext(context: BrowserContext) {
    this.context = context;
  }
}
