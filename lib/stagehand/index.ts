import { BrowserResult } from "@/types/browser";
import { LogLine } from "@/types/log";
import { BrowserContext, Page } from "@/types/page";
import { GotoOptions } from "@/types/playwright";
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
} from "@/types/stagehand";
import { Browserbase } from "@browserbasehq/sdk";
import { randomUUID } from "crypto";
import fs from "fs";
import { z } from "zod";
import { getBrowser } from "../browser";
import { scriptContent } from "../dom/build/scriptContent";
import { StagehandExtractHandler } from "../handlers/extractHandler";
import { StagehandObserveHandler } from "../handlers/observeHandler";
import { LLMClient } from "../llm/LLMClient";
import { LLMProvider } from "../llm/LLMProvider";
import { logLineToString } from "../utils";
import { StagehandContext } from "./context";
import { StagehandPage } from "./page";

const DEFAULT_MODEL_NAME = "gpt-4o";

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

  private internalLogger: (logLine: LogLine) => void;
  private apiKey: string | undefined;
  private projectId: string | undefined;
  // We want external logger to accept async functions
  private externalLogger?: (logLine: LogLine) => void | Promise<void>;
  private browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  public variables: { [key: string]: unknown };
  private contextPath?: string;
  private llmClient: LLMClient;

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
      browserbaseSessionCreateParams,
      domSettleTimeoutMs,
      enableCaching,
      browserbaseSessionID,
      modelName,
      modelClientOptions,
    }: ConstructorParams = {
      env: "BROWSERBASE",
    },
  ) {
    this.externalLogger = logger || defaultLogger;
    this.internalLogger = this.log.bind(this);
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
    this.llmClient = this.llmProvider.getClient(
      modelName ?? DEFAULT_MODEL_NAME,
      modelClientOptions,
    );
    this.domSettleTimeoutMs = domSettleTimeoutMs ?? 30_000;
    this.headless = headless ?? false;
    this.browserbaseSessionCreateParams = browserbaseSessionCreateParams;
    this.browserbaseSessionID = browserbaseSessionID;
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
    logObj.level = logObj.level || 1;

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
    logObj.level = logObj.level || 1;

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
