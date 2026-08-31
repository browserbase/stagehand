import fsp from "node:fs/promises";
import path from "node:path";
import type { ExperimentalBatchCallback, Page, Stagehand } from "@browserbasehq/stagehand";
import {
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  RefActionSchema,
  staleSnapshotIdError,
  type RefAction,
} from "./contract.js";
import { createPlaywrightCompatRuntime, type PlaywrightCompatTelemetry } from "./runtime.js";

type SnapshotState = { url: string; xpathById: Record<string, string> };
type HydratedAction = RefAction & { selector: string };
type ActionResult = { completed: number };
type ScreenshotArtifact = { path: string; base64: string };
type RunEnvelope = {
  __stagehandPlaywrightCompat: true;
  value: unknown;
  executionError?: { name: string; message: string; stack?: string };
  telemetry: PlaywrightCompatTelemetry;
  artifacts: ScreenshotArtifact[];
  closeRequested: boolean;
  batchRuntimeMs: number;
};

export type StagehandFacadeRunReport = {
  telemetry: PlaywrightCompatTelemetry;
  /** Wall-clock time of the whole experimentalBatch round trip. */
  batchRoundTripMs: number;
  /** Time the agent's code spent executing inside the batch. */
  batchRuntimeMs: number;
  closeRequested: boolean;
};

export type StagehandFacadeToolsOptions = {
  /** Directory that relative `page.screenshot({ path })` paths resolve against. Defaults to process.cwd(). */
  artifactRoot?: string;
  /** Observes every completed `run` batch (including ones whose code threw). */
  onRunReport?: (report: StagehandFacadeRunReport) => void;
};

const RUN_BATCH_TIMEOUT_MS = 60_000;

export type StagehandFacadeScreenshot = {
  data: string;
  mimeType: "image/png" | "image/jpeg";
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

const ACTION_RUNNER_SOURCE = `"use strict";
let completed = 0;
for (const action of input.actions) {
  const locator = stagehand.page.locator(action.selector);
  switch (action.op) {
    case "click": await locator.click(); break;
    case "hover": await locator.hover(); break;
    case "fill": await locator.fill(action.value); break;
    case "type": await locator.type(action.text, action.delay === undefined ? undefined : { delay: action.delay }); break;
    case "press": await locator.click(); await stagehand.page.keyPress(action.key); break;
    case "select": await locator.selectOption(action.values); break;
    default: throw new Error("Unsupported ref action: " + String(action.op));
  }
  completed += 1;
}
return { completed };`;

const actionRunner = new AsyncFunction(
  "stagehand",
  "input",
  ACTION_RUNNER_SOURCE,
) as ExperimentalBatchCallback<{ actions: HydratedAction[] }, ActionResult>;

const FACADE_PRELUDE = `"use strict";
const __stagehandCompatIdentity = (target) => target;
for (let index = 0; index <= 32; index += 1) {
  globalThis[index === 0 ? "__name" : "__name" + index] = __stagehandCompatIdentity;
}
const createRuntime = ${createPlaywrightCompatRuntime.toString()};
const runtime = await createRuntime(batchStagehand);
const page = runtime.page;
const context = runtime.context;
const browser = runtime.browser;
const console = globalThis.console;
const __stagehandBatchStartedAt = performance.now();
let value;
let executionError;
try {
  value = await (async () => { `;

const FACADE_EPILOGUE = `
  })();
} catch (error) {
  executionError = {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: typeof error?.message === "string" ? error.message : String(error),
    ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
  };
}
return {
  __stagehandPlaywrightCompat: true,
  value,
  executionError,
  telemetry: runtime.telemetry(),
  artifacts: runtime.artifacts(),
  closeRequested: runtime.closeRequested(),
  batchRuntimeMs: performance.now() - __stagehandBatchStartedAt,
};`;

export class StagehandFacadeTools {
  private readonly snapshotsByPage = new Map<string, SnapshotState>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stagehand: Stagehand,
    private readonly options: StagehandFacadeToolsOptions = {},
  ) {}

  snapshot(options: { includeIframes?: boolean } = {}): Promise<string> {
    return this.enqueue(() => this.snapshotNow(options));
  }

  screenshot(
    options: { fullPage?: boolean; type?: "png" | "jpeg"; quality?: number } = {},
  ): Promise<StagehandFacadeScreenshot> {
    return this.enqueue(() => this.screenshotNow(options));
  }

  runActions(actions: RefAction[]): Promise<{ completed: number; url: string }> {
    return this.enqueue(() => this.runActionsNow(actions));
  }

  run(code: string): Promise<unknown> {
    return this.enqueue(() => this.runNow(code));
  }

  private async snapshotNow(options: { includeIframes?: boolean }): Promise<string> {
    const page = await this.activePage();
    const snapshot = await page.snapshot({ includeIframes: options.includeIframes ?? true });
    this.snapshotsByPage.set(page.pageId, {
      url: await page.url(),
      xpathById: { ...snapshot.xpathMap },
    });
    return snapshot.formattedTree;
  }

  private async screenshotNow(options: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<StagehandFacadeScreenshot> {
    const page = await this.activePage();
    const type = options.type ?? "png";
    // CDP only accepts quality for jpeg, and only as an integer.
    const quality =
      type === "jpeg" && options.quality !== undefined ? Math.round(options.quality) : undefined;
    const bytes = await page.screenshot({
      type,
      ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
      ...(quality === undefined ? {} : { quality }),
    });
    return {
      data: Buffer.from(bytes).toString("base64"),
      mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
    };
  }

  private async runActionsNow(actions: RefAction[]): Promise<{ completed: number; url: string }> {
    const parsed = RefActionSchema.array().min(1).parse(actions);
    const page = await this.activePage();
    const snapshot = this.snapshotsByPage.get(page.pageId);
    if (!snapshot) throw new Error(NO_HYDRATED_SNAPSHOT_ERROR);

    if ((await page.url()) !== snapshot.url) {
      this.snapshotsByPage.delete(page.pageId);
      throw new Error(NAVIGATED_SNAPSHOT_ERROR);
    }

    const hydrated = parsed.map((action) => {
      const xpath = trimTrailingTextNode(resolveSnapshotXPath(snapshot.xpathById, action.id));
      if (!xpath) throw new Error(staleSnapshotIdError(action.id));
      return { ...action, selector: `xpath=${xpath}` };
    });
    const runBatch = () =>
      this.stagehand.experimentalBatch(
        actionRunner,
        { actions: hydrated },
        { page, timeout: 60_000 },
      );
    let result: ActionResult | undefined;
    try {
      result = await runBatch();
    } catch (error) {
      // A freshly hydrated element with no layout box is usually mid-render
      // (menus, lazy lists); give it one beat before reporting.
      if (!isLayoutError(error)) throw error;
      await page.waitForTimeout(250);
      result = await runBatch();
    }
    return { completed: result?.completed ?? hydrated.length, url: await page.url() };
  }

  private async runNow(code: string): Promise<unknown> {
    const page = await this.activePage();
    const callback = new AsyncFunction(
      "batchStagehand",
      "input",
      FACADE_PRELUDE + code + FACADE_EPILOGUE,
    ) as ExperimentalBatchCallback<Record<string, never>, RunEnvelope>;
    const startedAt = performance.now();
    const envelope = await this.runBatchWithActivePageFallback(callback, page);
    this.options.onRunReport?.({
      telemetry: envelope.telemetry,
      batchRoundTripMs: performance.now() - startedAt,
      batchRuntimeMs: envelope.batchRuntimeMs,
      closeRequested: envelope.closeRequested,
    });
    await this.writeScreenshotArtifacts(envelope.artifacts);
    if (envelope.executionError) {
      const error = new Error(envelope.executionError.message);
      error.name = envelope.executionError.name;
      if (envelope.executionError.stack) error.stack = envelope.executionError.stack;
      throw error;
    }
    return envelope.value;
  }

  /**
   * The batch controller resolves its target page before invoking the
   * callback, so when the active page vanished between activePage() and the
   * batch (tab closed by the previous snippet) this retry cannot replay
   * partially executed agent code.
   */
  private async runBatchWithActivePageFallback(
    callback: ExperimentalBatchCallback<Record<string, never>, RunEnvelope>,
    page: Page,
  ): Promise<RunEnvelope> {
    try {
      return await this.stagehand.experimentalBatch(
        callback,
        {},
        { page, timeout: RUN_BATCH_TIMEOUT_MS },
      );
    } catch (error) {
      if (!(error instanceof Error) || !/callback batch page was not found/iu.test(error.message)) {
        throw error;
      }
      const context = this.stagehand.browser.context;
      if (!(await context.activePage())) await context.newPage();
      return await this.stagehand.experimentalBatch(
        callback,
        {},
        { timeout: RUN_BATCH_TIMEOUT_MS },
      );
    }
  }

  private async writeScreenshotArtifacts(artifacts: ScreenshotArtifact[]): Promise<void> {
    const root = this.options.artifactRoot ?? process.cwd();
    for (const artifact of artifacts) {
      const target = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(root, artifact.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, Buffer.from(artifact.base64, "base64"));
    }
  }

  private async activePage(): Promise<Page> {
    const page = await this.stagehand.browser.context.activePage();
    if (!page) throw new Error("Stagehand has no active page.");
    return page;
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function trimTrailingTextNode(path: string | undefined): string | undefined {
  return path?.replace(/\/text\(\)(\[\d+\])?$/iu, "");
}

/**
 * Snapshot IDs are `<frameOrdinal>-<backendNodeId>` (e.g. "0-7812"). Models
 * regularly copy only the backend id; accept that when it is unambiguous.
 */
function resolveSnapshotXPath(xpathById: Record<string, string>, id: string): string | undefined {
  const exact = xpathById[id];
  if (exact !== undefined) return exact;
  if (id.includes("-")) return undefined;
  const suffix = `-${id}`;
  const matches = Object.keys(xpathById).filter((key) => key.endsWith(suffix));
  return matches.length === 1 ? xpathById[matches[0]!] : undefined;
}

function isLayoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /layout object|box model/iu.test(message);
}
