import { type Page, type BrowserContext, chromium } from "@playwright/test";
import { expect } from "@playwright/test";
import OpenAI from "openai";
import crypto from "crypto";
import Instructor, { type InstructorClient } from "@instructor-ai/instructor";
import { z } from "zod";
import fs from "fs";
import { act, ask, extract, observe } from "./inference";
import { LLMProvider } from "./LLMProvider";
const merge = require("deepmerge");
import path from "path";

require("dotenv").config({ path: ".env" });

async function getBrowser(env: "LOCAL" | "BROWSERBASE" = "LOCAL") {
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
        headless: false,
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
  public verbose: boolean;
  public debugDom: boolean;

  constructor(
    {
      env,
      verbose = false,
      debugDom = false,
      llmProvider,
    }: {
      env: "LOCAL" | "BROWSERBASE";
      verbose?: boolean;
      debugDom?: boolean;
      llmProvider?: LLMProvider;
    } = {
      env: "BROWSERBASE",
    }
  ) {
    this.llmProvider = llmProvider || new LLMProvider();
    this.env = env;
    this.observations = {};
    this.actions = {};
    this.verbose = verbose;
    this.debugDom = debugDom;
  }

  log({ category, message }: { category?: string; message: string }) {
    if (this.verbose) {
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

  async init() {
    const { context } = await getBrowser(this.env);
    this.context = context;
    this.page = context.pages()[0];
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
      await this.page.evaluate(() => window.waitForDomSettle());
    } catch (e) {
      console.log(e);
    }
  }

  async startDomDebug() {
    if (this.debugDom) {
      await this.page.evaluate(() => window.debugDom());
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
    model_name = "gpt-4o",
  }: {
    instruction: string;
    schema: T;
    progress?: string;
    content?: z.infer<T>;
    chunksSeen?: Array<number>;
  }): Promise<z.infer<T>> {
    this.log({
      category: "extraction",
      message: `starting extraction ${instruction}`,
    });

    await this.waitForSettledDom();
    await this.startDomDebug();
    const { outputString, chunk, chunks } = await this.page.evaluate(() =>
      window.processDom([])
    );

    const extractionResponse = await extract({
      instruction,
      progress,
      domElements: outputString,
      client: this.llmProvider.getInstructorClient(),
      schema,
      model_name,
    });
    const { progress: newProgress, completed, ...output } = extractionResponse;
    await this.cleanupDomDebug();

    chunksSeen.push(chunk);

    if (completed || chunksSeen.length === chunks.length) {
      this.log({
        category: "extraction",
        message: `response: ${JSON.stringify(extractionResponse)}`,
      });

      return merge(content, output);
    } else {
      this.log({
        category: "extraction",
        message: `continuing extraction, progress: ${progress + newProgress + ", "}`,
      });
      return this.extract({
        instruction,
        schema,
        progress: progress + newProgress + ", ",
        content: merge(content, output),
        chunksSeen,
      });
    }
  }

  async observe(observation: string, model_name: string = "gpt-4o"): Promise<string | null> {
    this.log({
      category: "observation",
      message: `starting observation: ${observation}`,
    });

    await this.waitForSettledDom();
    await this.startDomDebug();
    const { outputString, selectorMap } = await this.page.evaluate(() =>
      window.processDom([])
    );

    const elementId = await observe({
      observation,
      domElements: outputString,
      client: this.llmProvider.getOpenAIClient(),
      model_name,
    });
    await this.cleanupDomDebug();

    if (elementId === "NONE") {
      this.log({
        category: "observation",
        message: `no element found for ${observation}`,
      });
      return null;
    }

    this.log({
      category: "observation",
      message: `found element ${elementId}`,
    });

    const selector = selectorMap[parseInt(elementId)];
    const locatorString = `xpath=${selector}`;

    this.log({
      category: "observation",
      message: `found locator ${locatorString}`,
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
  async ask(question: string, model_name: string = "gpt-4o"): Promise<string | null> {
    return ask({
      question,
      client: this.llmProvider.getOpenAIClient(),
      model_name,
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
    model_name = "gpt-4o",
  }: {
    action: string;
    steps?: string;
    chunksSeen?: Array<number>;
  }): Promise<void> {
    this.log({
      category: "action",
      message: `taking action: ${action}`,
    });

    await this.waitForSettledDom();
    await this.startDomDebug();
    const { outputString, selectorMap, chunk, chunks } =
      await this.page.evaluate(
        (chunksSeen) => window.processDom(chunksSeen),
        chunksSeen
      );

    const response = await act({
      action,
      domElements: outputString,
      steps,
      client: this.llmProvider.getOpenAIClient(),
      model_name,
    });
    await this.cleanupDomDebug();

    chunksSeen.push(chunk);
    if (!response) {
      if (chunksSeen.length < chunks.length) {
        this.log({
          category: "action",
          message: `no response from act with chunk ${JSON.stringify(chunks.length - chunksSeen.length)} remaining`,
        });

        return this.act({
          action,
          steps: steps + "Scrolled to another section, ",
          chunksSeen,
        });
      } else {
        this.log({
          category: "action",
          message: "no response from act with no chunks left to check",
        });
        this.recordAction(action, null);
        return;
      }
    }

    this.log({
      category: "action",
      message: `response: ${JSON.stringify(response)}`,
    });

    const element = response["element"];
    const path = selectorMap[element];
    const method = response["method"];
    const args = response["args"];

    this.log({
      category: "action",
      message: `
      step: ${response.step}
      ${method} on ${path} with args ${args}
      ${response.why}
      `,
    });
    const locator = await this.page.locator(`xpath=${path}`).first();
    if (typeof locator[method as keyof typeof locator] === "function") {
      //@ts-ignore playwright's TS does not think this is valid, but we proved it with the check above
      await locator[method](...args);
    } else {
      throw new Error(`stagehand: chosen method ${method} is invalid`);
    }

    if (!response.completed) {
      this.log({
        category: "action",
        message: "continuing to next sub action",
      });
      return this.act({
        action,
        steps: steps + response.step + ", ",
      });
    }
  }
  setPage(page: Page) {
    this.page = page;
  }
  setContext(context: BrowserContext) {
    this.context = context;
  }
}
