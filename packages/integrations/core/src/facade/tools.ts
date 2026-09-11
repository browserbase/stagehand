import type { ExperimentalBatchCallback, Page, Stagehand } from "@browserbasehq/stagehand";
import {
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  RefActionSchema,
  staleSnapshotIdError,
  type RefAction,
} from "./contract.js";
import { createPlaywrightCompatRuntime } from "./runtime.js";

type SnapshotState = { url: string; xpathById: Record<string, string> };
type HydratedAction = RefAction & { selector: string };
type ActionResult = { completed: number };
type RunEnvelope = {
  __stagehandPlaywrightCompat: true;
  value: unknown;
  closeRequested: boolean;
  executionError?: { name: string; message: string };
};

export type StagehandFacadeToolsOptions = {
  onCloseRequested?: () => Promise<void>;
};

export type StagehandFacadeScreenshot = {
  data: string;
  mimeType: "image/png" | "image/jpeg";
};

export class StagehandFacadeCleanupError extends Error {
  override readonly name = "StagehandFacadeCleanupError";

  constructor() {
    super("Failed to close the Stagehand browser session.");
  }
}

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
  };
}
return {
  __stagehandPlaywrightCompat: true,
  value,
  closeRequested: runtime.closeRequested(),
  executionError,
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
      const xpath = trimTrailingTextNode(snapshot.xpathById[action.id]);
      if (!xpath) throw new Error(staleSnapshotIdError(action.id));
      return { ...action, selector: `xpath=${xpath}` };
    });
    const result = await this.stagehand.experimentalBatch(
      actionRunner,
      { actions: hydrated },
      { page, timeout: 60_000 },
    );
    return { completed: result?.completed ?? hydrated.length, url: await page.url() };
  }

  private async runNow(code: string): Promise<unknown> {
    const page = await this.activePage();
    const callback = new AsyncFunction(
      "batchStagehand",
      "input",
      FACADE_PRELUDE + code + FACADE_EPILOGUE,
    ) as ExperimentalBatchCallback<Record<string, never>, RunEnvelope>;
    const envelope = await this.stagehand.experimentalBatch(
      callback,
      {},
      { page, timeout: 60_000 },
    );
    let closeError: StagehandFacadeCleanupError | undefined;
    if (envelope.closeRequested) {
      if (!this.options.onCloseRequested) {
        closeError = new StagehandFacadeCleanupError();
      } else {
        try {
          await this.options.onCloseRequested();
        } catch {
          closeError = new StagehandFacadeCleanupError();
        }
      }
    }
    if (envelope.executionError) {
      const error = executionErrorFromEnvelope(envelope.executionError);
      if (closeError) {
        throw new AggregateError([error, closeError], "Run failed and cleanup also failed.");
      }
      throw error;
    }
    if (closeError) throw closeError;
    return envelope.value;
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

function executionErrorFromEnvelope(envelope: { name: string; message: string }): Error {
  const error = new Error(sanitizeFacadeErrorMessage(envelope.message));
  const name = sanitizeFacadeErrorMessage(envelope.name);
  error.name = /^[A-Za-z][A-Za-z0-9]*Error$/u.test(name) ? name : "Error";
  // The worker stack can contain browser internals or sensitive model-authored values.
  // Keep the useful error category and sanitized message without transporting that stack.
  error.stack = undefined;
  return error;
}

export function sanitizeFacadeErrorMessage(message: string): string {
  return message
    .replace(/([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s"']+/giu, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/gu, "$1[redacted]")
    .replace(/\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+/gu, "$1[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}/gu, "AIza[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu, "$1[redacted]");
}
