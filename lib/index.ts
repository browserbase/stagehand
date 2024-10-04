import { type Page, type BrowserContext, chromium } from "@playwright/test";
import { expect } from "@playwright/test";
import crypto from "crypto";
import { z } from "zod";
import fs from "fs";
import { act, ask, extract, observe } from "./inference";
import { LLMProvider } from "./llm/LLMProvider";
const merge = require("deepmerge");
import path from "path";

require("dotenv").config({ path: ".env" });

async function getBrowser(env: "LOCAL" | "BROWSERBASE" = "LOCAL", headless: boolean = false) {
  if (process.env.BROWSERBASE_API_KEY && env !== "LOCAL") {
    console.log("Connecting you to broswerbase...");
    const browser = await chromium.connectOverCDP(
      `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`
    );
    const context = browser.contexts()[0];
    return { browser, context };
  } else {
    if (!process.env.BROWSERBASE_API_KEY) {
      console.log("No browserbase key detected");
      console.log("Starting a local browser...");
    }

    console.log(`Launching browser in ${headless ? 'headless' : 'headed'} mode`);

    const tmpDir = fs.mkdtempSync(`/tmp/pwtest`);
    fs.mkdirSync(`${tmpDir}/userdir/Default`, { recursive: true });

    const defaultPreferences = {
      plugins: {
        always_open_pdf_externally: true,
      },
    };

    fs.writeFileSync(
      `${tmpDir}/userdir/Default/Preferences`,
      JSON.stringify(defaultPreferences)
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
      }
    );

    console.log("Local browser started successfully.");
    return { context };
  }
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
  private logger: (message: { category?: string; message: string }) => void;

  constructor(
    {
      env,
      verbose = 0,
      debugDom = false,
      llmProvider,
      headless = false,
    }: {
      env: "LOCAL" | "BROWSERBASE";
      verbose?: 0 | 1 | 2;
      debugDom?: boolean;
      llmProvider?: LLMProvider;
      headless?: boolean;
    } = {
      env: "BROWSERBASE",
    }
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
  }

  log({ category, message, level = 1 }: { category?: string; message: string; level?: 0 | 1 | 2 }) {
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
    const { context } = await getBrowser(this.env, this.headless);
    this.context = context;
    this.page = context.pages()[0];
    this.defaultModelName = modelName;

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
  }


  async waitForSettledDom() {
    try {
      await this.page.waitForSelector("body");
      await this.page.waitForLoadState('domcontentloaded');

      await this.page.evaluate(() => {
        return new Promise<void>((resolve) => {
          if (typeof window.waitForDomSettle === 'function') {
            window.waitForDomSettle().then(() => {
              resolve();
            });
          } else {
            console.warn('waitForDomSettle is not defined, considering DOM as settled');
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
        if (typeof window.debugDom === 'function') {
          window.debugDom();
        } else {
          console.warn('debugDom is not defined');
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

  async extract<T extends z.AnyZodObject>({
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
      message: `starting extraction ${instruction}`,
      level: 1
    });

    await this.waitForSettledDom();
    await this.startDomDebug();
    const { outputString, chunk, chunks } = await this.page.evaluate(() =>
      window.processDom([])
    );
    this.log({
      category: "extraction",
      message: `Received output from processDom. Chunk: ${chunk}, Chunks left: ${chunks.length - chunksSeen.length}`,
      level: 1,
    });

    const extractionResponse = await extract({
      instruction,
      progress,
      domElements: outputString,
      llmProvider: this.llmProvider,
      schema,
      modelName: modelName || this.defaultModelName,
    });
    const { progress: newProgress, completed, ...output } = extractionResponse;
    await this.cleanupDomDebug();

    this.log({
      category: "extraction",
      message: `Received extraction response: ${JSON.stringify(extractionResponse)}`,
      level: 1,
    });

    chunksSeen.push(chunk);

    if (completed || chunksSeen.length === chunks.length) {
      this.log({
        category: "extraction",
        message: `response: ${JSON.stringify(extractionResponse)}`,
        level: 1
      });

      return merge(content, output);
    } else {
      this.log({
        category: "extraction",
        message: `continuing extraction, progress: ${progress + newProgress + ", "}`,
        level: 1
      });
      await this.waitForSettledDom();
      return this.extract({
        instruction,
        schema,
        progress: progress + newProgress + ", ",
        content: merge(content, output),
        chunksSeen,
        modelName,
      });
    }
  }

  async observe(observation: string, modelName?: string): Promise<string | null> {
    this.log({
      category: "observation",
      message: `starting observation: ${observation}`,
      level: 1
    });

    await this.waitForSettledDom();
    await this.startDomDebug();
    const { outputString, selectorMap } = await this.page.evaluate(() =>
      window.processDom([])
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
        level: 1
      });
      return null;
    }

    this.log({
      category: "observation",
      message: `found element ${elementId}`,
      level: 1
    });

    const selector = selectorMap[parseInt(elementId)];
    const locatorString = `xpath=${selector}`;

    this.log({
      category: "observation",
      message: `found locator ${locatorString}`,
      level: 1
    });

    // the locator string found by the LLM might resolve to multiple places in the DOM
    const firstLocator = this.page.locator(locatorString).first();

    await expect(firstLocator).toBeAttached();
    const observationId = await this.recordObservation(
      observation,
      locatorString
    );

    return observationId;
  }
  async ask(question: string, modelName?: string): Promise<string | null> {
    return ask({
      question,
      llmProvider: this.llmProvider,
      modelName: modelName || this.defaultModelName,
    });
  }

  async recordObservation(
    observation: string,
    result: string
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

  async act({
    action,
    steps = "",
    chunksSeen = [],
    modelName,
  }: {
    action: string;
    steps?: string;
    chunksSeen?: Array<number>;
    modelName?: string;
  }): Promise<{ success: boolean; message: string; action: string }> {
    this.log({
      category: "action",
      message: `Starting action: ${action}`,
      level: 1,
    });

    await this.waitForSettledDom();

    await this.startDomDebug();

    const { outputString, selectorMap, chunk, chunks } =
      await this.page.evaluate(
        (chunksSeen) => {
          return window.processDom(chunksSeen);
        },
        chunksSeen
      );

    this.log({
      category: "action",
      message: `Received output from processDom. Chunk: ${chunk}, Chunks left: ${chunks.length - chunksSeen.length}`,
      level: 1,
    });

    await this.waitForSettledDom();

    const response = await act({
      action,
      domElements: outputString,
      steps,
      llmProvider: this.llmProvider,
      modelName: modelName || this.defaultModelName,
    });

    this.log({
      category: "action",
      message: `Received response from LLM: ${JSON.stringify(response)}`,
      level: 1,
    });

    await this.cleanupDomDebug();

    chunksSeen.push(chunk);
    if (!response) {
      if (chunksSeen.length < chunks.length) {
        this.log({
          category: "action",
          message: `No response from act. Chunks seen: ${chunksSeen.length}, Total chunks: ${chunks.length}`,
          level: 1,
        });
        await this.waitForSettledDom();
        return this.act({
          action,
          steps: steps + "Scrolled to another section, ",
          chunksSeen,
          modelName,
        });
      } else {
        this.log({
          category: "action",
          message: "No response from act with no chunks left to check",
          level: 1,
        });
        this.recordAction(action, null);
        return {
          success: false,
          message: "Action not found on the current page after checking all chunks.",
          action: action,
        };
      }
    }

    const element = response["element"];
    const path = selectorMap[element];
    const method = response["method"];
    const args = response["args"];

    this.log({
      category: "action",
      message: `Executing method: ${method} on element: ${element} (path: ${path}) with args: ${JSON.stringify(args)}`,
      level: 1,
    });

    const locator = await this.page.locator(`xpath=${path}`).first();
    try {
      if (method === 'scrollIntoView') {
        this.log({
          category: "action",
          message: `Scrolling element into view`,
          level: 2,
        });
        await locator.evaluate((element) => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else if (typeof locator[method as keyof typeof locator] === "function") {

        const isLink = await locator.evaluate((element) => {
          return element.tagName.toLowerCase() === 'a' && element.hasAttribute('href');
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

        // Log current URL after action
        this.log({
          category: "action",
          message: `Current page URL after action: ${this.page.url()}`,
          level: 2,
        });

        // Check if a new page was created, but only if the method is 'click'
        if (method === 'click') {
          if (isLink) {
            this.log({
              category: "action",
              message: `Clicking link, checking for new page`,
              level: 1,
            });
            const newPagePromise = Promise.race([
              new Promise<Page | null>((resolve) => {
                this.context.once('page', (page) => resolve(page));
                setTimeout(() => resolve(null), 1500); // 1500ms timeout
              })
            ]);
            const newPage = await newPagePromise;
            if (newPage) {
              const newUrl = await newPage.url();
              this.log({
                category: "action",
                message: `New page detected with URL: ${newUrl}`,
                level: 1,
              });
              await newPage.close(); // Close the new page/tab
              await this.page.goto(newUrl); // Navigate to the new URL in the current tab
              await this.page.waitForLoadState("domcontentloaded");
              await this.waitForSettledDom();
            } else {
              this.log({
                category: "action",
                message: `No new page opened after clicking link`,
                level: 1,
              });
            }
          }
        }
      } else {
        throw new Error(`stagehand: chosen method ${method} is invalid`);
      }

      if (!response.completed) {
        this.log({
          category: "action",
          message: "Continuing to next sub action",
          level: 1,
        });
        await this.waitForSettledDom();
        const nextResult = await this.act({
          action,
          steps: steps + response.step + ", ",
          chunksSeen,
          modelName,
        });
        return nextResult;
      }
      return {
        success: true,
        message: `Action completed successfully: ${steps}${response.step}`,
        action: action,
      };
    } catch (error) {
      this.log({
        category: "action",
        message: `Error performing action: ${error.message}`,
        level: 1,
      });
      return {
        success: false,
        message: `Error performing action: ${error.message}`,
        action: action,
      };
    }
  }
  setPage(page: Page) {
    this.page = page;
  }
  setContext(context: BrowserContext) {
    this.context = context;
  }
}
