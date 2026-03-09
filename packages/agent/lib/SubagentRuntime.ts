import fs from "node:fs/promises";
import path from "node:path";
import {
  Stagehand,
  jsonSchemaToZod,
  type AgentConfig,
  type LocalBrowserLaunchOptions,
  type V3,
  type V3Options,
} from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import {
  type AgentSubagentConfig,
  type BrowserId,
  type JsonObject,
  type NavigateResult,
  type ScreenshotResult,
  NavigateResultSchema,
  ScreenshotResultSchema,
  type SubagentTaskRecord,
  type WebActArgs,
  type WebExtractArgs,
  type WebNavigateArgs,
  type WebObserveArgs,
  type WebScreenshotArgs,
} from "./protocol.js";
import {
  appendSubagentTaskRecord,
  cloneSeedUserDataDir,
  createSubagentTaskRecord,
  readSubagentTaskQueue,
  type SubagentWorkspaceLayout,
} from "./workspace.js";

const DEFAULT_VIEWPORT = { width: 1400, height: 900 } as const;
const DEFAULT_SUBAGENT_MAX_STEPS = 20;

type StagehandFactory = (options: V3Options) => V3;

type DelegatedTaskInput = {
  instruction: string;
  expectedOutputJsonSchema?: JsonObject;
  maxSteps?: number;
};

type PageLike = Awaited<ReturnType<V3["context"]["awaitActivePage"]>>;

function stagehandFactory(options: V3Options): V3 {
  return new Stagehand(options);
}

async function appendJsonlLog(logPath: string, event: unknown): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

function normalizeAgentConfig(
  config: AgentSubagentConfig | undefined,
): AgentConfig {
  return {
    mode: config?.mode ?? "dom",
    model: config?.model,
    executionModel: config?.executionModel,
    systemPrompt: config?.systemPrompt,
  };
}

function isMainFramePage(page: NonNullable<PageLike>, frameId: string): boolean {
  return typeof page.mainFrameId === "function" && page.mainFrameId() === frameId;
}

export class SubagentRuntime {
  public readonly browserId: BrowserId;
  public readonly subagentDir: string;
  public readonly chromeProfileDir: string;
  public readonly downloadsDir: string;
  public readonly logsDir: string;
  public readonly screenshotsDir: string;
  public readonly todoPath: string;

  private readonly workspace: SubagentWorkspaceLayout;
  private readonly config: AgentSubagentConfig | undefined;
  private readonly createStagehand: StagehandFactory;
  private readonly agentConfig: AgentConfig;
  private stagehand: V3 | null = null;
  private initPromise: Promise<void> | null = null;
  private delegatedTaskTail: Promise<unknown> = Promise.resolve();

  constructor(options: {
    browserId: BrowserId;
    workspace: SubagentWorkspaceLayout;
    config?: AgentSubagentConfig;
    stagehandFactory?: StagehandFactory;
  }) {
    this.browserId = options.browserId;
    this.workspace = options.workspace;
    this.config = options.config;
    this.createStagehand = options.stagehandFactory ?? stagehandFactory;
    this.agentConfig = normalizeAgentConfig(options.config);
    this.subagentDir = options.workspace.rootDir;
    this.chromeProfileDir = options.workspace.chromeProfileDir;
    this.downloadsDir = options.workspace.downloadsDir;
    this.logsDir = options.workspace.logsDir;
    this.screenshotsDir = options.workspace.screenshotsDir;
    this.todoPath = options.workspace.todoPath;
  }

  public get browser(): { pages: Array<{ url(): string }> } {
    return {
      pages: this.stagehand?.context.pages() ?? [],
    };
  }

  public get agent(): { execute: (input: unknown) => Promise<unknown> } {
    return {
      execute: async (input) => {
        if (typeof input === "string") {
          return await this.enqueueDelegatedTask({ instruction: input });
        }

        const parsed = z
          .object({
            instruction: z.string(),
            maxSteps: z.number().int().positive().optional(),
            output: z.unknown().optional(),
          })
          .passthrough()
          .parse(input);

        return await this.executeDelegatedTask({
          instruction: parsed.instruction,
          maxSteps: parsed.maxSteps,
          expectedOutputJsonSchema:
            parsed.output && typeof parsed.output === "object"
              ? (parsed.output as JsonObject)
              : undefined,
        });
      },
    };
  }

  public async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.startStagehand();
    }
    await this.initPromise;
  }

  public async close(): Promise<void> {
    await this.stagehand?.close();
    this.stagehand = null;
    this.initPromise = null;
  }

  public async readTaskQueue(): Promise<SubagentTaskRecord[]> {
    return await readSubagentTaskQueue(this.todoPath);
  }

  public async enqueueDelegatedTask(
    input: DelegatedTaskInput,
  ): Promise<unknown> {
    await this.init();
    const initialRecord = createSubagentTaskRecord({
      browser_id: this.browserId,
      instruction: input.instruction,
      expected_output_jsonschema: input.expectedOutputJsonSchema,
    });
    await appendSubagentTaskRecord(this.todoPath, initialRecord);

    const run: Promise<unknown> = this.delegatedTaskTail.then(
      async (): Promise<unknown> => {
        await appendSubagentTaskRecord(this.todoPath, {
          ...initialRecord,
          status: "running",
          updated_at: new Date().toISOString(),
        });
        return await this.executeDelegatedTask(input, initialRecord.id);
      },
    );

    this.delegatedTaskTail = run.catch((): undefined => undefined);
    return await run;
  }

  public async act(input: string | WebActArgs): Promise<unknown> {
    await this.init();
    const microtask = typeof input === "string" ? input : input.microtask;
    const page = await this.resolvePage(
      typeof input === "string" ? undefined : input.frame_id,
    );
    const result = await this.requireStagehand().act(microtask, { page });
    await this.log("act.jsonl", { microtask, result });
    return result;
  }

  public async extract(input: {
    instruction?: string;
    frameId?: string;
    expectedOutputJsonSchema?: JsonObject;
  }): Promise<unknown> {
    await this.init();
    const page = await this.resolvePage(input.frameId);
    const stagehand = this.requireStagehand();

    let result: unknown;
    if (input.expectedOutputJsonSchema) {
      const schema = jsonSchemaToZod(
        input.expectedOutputJsonSchema as unknown as import("@browserbasehq/stagehand").JsonSchema,
      );
      result = await stagehand.extract(
        input.instruction ?? "Extract the requested structured data.",
        schema,
        { page },
      );
    } else if (input.instruction) {
      result = await stagehand.extract(input.instruction, { page });
    } else {
      result = await stagehand.extract({ page });
    }

    await this.log("extract.jsonl", { input, result });
    return result;
  }

  public async observe(input: {
    instruction?: string;
    frameId?: string;
  }): Promise<unknown> {
    await this.init();
    const page = await this.resolvePage(input.frameId);
    const stagehand = this.requireStagehand();
    const result = input.instruction
      ? await stagehand.observe(input.instruction, { page })
      : await stagehand.observe({ page });
    await this.log("observe.jsonl", { input, result });
    return result;
  }

  public async navigate(
    input: string | { url: string; waitUntil?: WebNavigateArgs["waitUntil"] },
  ): Promise<NavigateResult> {
    await this.init();
    const url = typeof input === "string" ? input : input.url;
    const waitUntil = typeof input === "string" ? undefined : input.waitUntil;
    const page = await this.resolvePage();
    const response = await page.goto(url, { waitUntil });
    const result = NavigateResultSchema.parse({
      url: page.url(),
      status: response ? response.status() : null,
      ok: response ? response.ok() : null,
      status_text: response ? response.statusText() : null,
      headers: response ? response.headers() : undefined,
    });
    await this.log("navigate.jsonl", { url, waitUntil, result });
    return result;
  }

  public async screenshot(input: {
    frameId?: string;
    selector?: string;
    yOffset?: number;
  }): Promise<ScreenshotResult> {
    await this.init();
    const page = await this.resolvePage(input.frameId);
    const frame = await this.resolveFrame(page, input.frameId);

    if (input.selector) {
      await page.evaluate(
        ({ selector, yOffset }) => {
          const element = document.querySelector(selector);
          if (!element) {
            throw new Error(`Could not find selector for screenshot: ${selector}`);
          }
          element.scrollIntoView({ block: "center", inline: "center" });
          if (typeof yOffset === "number" && yOffset !== 0) {
            window.scrollBy(0, yOffset);
          }
        },
        { selector: input.selector, yOffset: input.yOffset },
      );
    }

    const savePath = path.join(
      this.screenshotsDir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${this.browserId}.png`,
    );

    if (frame) {
      const buffer = await frame.screenshot({ type: "png" });
      await fs.writeFile(savePath, buffer);
    } else {
      await page.screenshot({
        path: savePath,
        type: "png",
        fullPage: !input.selector,
      });
    }

    const result = ScreenshotResultSchema.parse({
      browser_id: this.browserId,
      frame_id: input.frameId,
      path: savePath,
      url: page.url(),
      selector: input.selector,
      y_offset: input.yOffset,
    });
    await this.log("screenshot.jsonl", { input, result });
    return result;
  }

  private async startStagehand(): Promise<void> {
    await fs.mkdir(this.subagentDir, { recursive: true });
    await fs.mkdir(this.downloadsDir, { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    await cloneSeedUserDataDir(
      this.config?.localBrowserLaunchOptions?.userDataDir,
      this.chromeProfileDir,
    );

    const launchOptions = this.buildLaunchOptions(
      this.config?.localBrowserLaunchOptions,
    );
    const subagentLogPath = path.join(this.logsDir, "stagehand.jsonl");
    const stagehand = this.createStagehand({
      env: "LOCAL",
      verbose: this.config?.verbose,
      experimental: this.config?.experimental,
      localBrowserLaunchOptions: launchOptions,
      logger: (line) => {
        void appendJsonlLog(subagentLogPath, line);
      },
    });
    await stagehand.init();
    this.stagehand = stagehand;
  }

  private buildLaunchOptions(
    launchOptions: LocalBrowserLaunchOptions | undefined,
  ): LocalBrowserLaunchOptions {
    return {
      ...launchOptions,
      userDataDir: this.chromeProfileDir,
      preserveUserDataDir: true,
      downloadsPath: this.downloadsDir,
      acceptDownloads: true,
      viewport: launchOptions?.viewport ?? DEFAULT_VIEWPORT,
    };
  }

  private async executeDelegatedTask(
    input: DelegatedTaskInput,
    taskId?: string,
  ): Promise<unknown> {
    const stagehandAgent = this.requireStagehand().agent({
      ...this.agentConfig,
      stream: false,
    });
    const executeOptions: {
      instruction: string;
      maxSteps: number;
      output?: z.ZodObject<Record<string, z.ZodType>>;
    } = {
      instruction: input.instruction,
      maxSteps: input.maxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS,
    };

    if (input.expectedOutputJsonSchema) {
      const schema = jsonSchemaToZod(
        input.expectedOutputJsonSchema as unknown as import("@browserbasehq/stagehand").JsonSchema,
      );
      executeOptions.output =
        schema instanceof z.ZodObject
          ? schema
          : z.object({ value: schema as z.ZodTypeAny });
    }

    try {
      const result = await stagehandAgent.execute(executeOptions);
      if (taskId) {
        await appendSubagentTaskRecord(this.todoPath, {
          id: taskId,
          browser_id: this.browserId,
          instruction: input.instruction,
          status: "completed",
          expected_output_jsonschema: input.expectedOutputJsonSchema,
          result,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await this.log("delegated-task.jsonl", { taskId, input, result });
      return result;
    } catch (error) {
      if (taskId) {
        await appendSubagentTaskRecord(this.todoPath, {
          id: taskId,
          browser_id: this.browserId,
          instruction: input.instruction,
          status: "failed",
          expected_output_jsonschema: input.expectedOutputJsonSchema,
          error: error instanceof Error ? error.message : String(error),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      await this.log("delegated-task.jsonl", {
        taskId,
        input,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private requireStagehand(): V3 {
    if (!this.stagehand) {
      throw new Error(`Subagent ${this.browserId} has not been initialized.`);
    }
    return this.stagehand;
  }

  private async resolvePage(frameId?: string): Promise<NonNullable<PageLike>> {
    const stagehand = this.requireStagehand();
    if (frameId) {
      const mainFramePage = stagehand.context.resolvePageByMainFrameId(frameId);
      if (mainFramePage) {
        return mainFramePage;
      }
    }

    const activePage = await stagehand.context.awaitActivePage();
    if (!activePage) {
      throw new Error(`Subagent ${this.browserId} does not have an active page.`);
    }
    return activePage;
  }

  private async resolveFrame(
    page: NonNullable<PageLike>,
    frameId?: string,
  ): Promise<{ screenshot: (options?: { type?: "png" | "jpeg" }) => Promise<Buffer> } | null> {
    if (!frameId || isMainFramePage(page, frameId)) {
      return null;
    }

    // Best effort only: non-main-frame ids are resolved against the active page.
    // The higher-level protocol remains serializable even if this later becomes
    // a richer frame registry lookup.
    return page.frameForId(frameId);
  }

  private async log(filename: string, event: unknown): Promise<void> {
    await appendJsonlLog(path.join(this.logsDir, filename), {
      browserId: this.browserId,
      at: new Date().toISOString(),
      event,
    });
  }
}
