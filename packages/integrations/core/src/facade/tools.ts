import fsp from "node:fs/promises";
import path from "node:path";
import type { ExperimentalBatchCallback, Page, Stagehand } from "@browserbasehq/stagehand";
import { sanitizeErrorMessage } from "../harness/redact.js";
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
  /**
   * Keep a hidden about:blank tab open for the whole session (default true).
   * Chrome exits when its last tab closes, so a renderer crash on the agent's
   * only tab ("Render process gone" on heavy retail pages) used to end the
   * Browserbase session and turn one bad page into a terminal
   * "Browser session lost". With the keeper, the browser survives and the next
   * call gets a fresh page instead. The keeper is invisible to agent code
   * (`context.pages()` / `waitForEvent("page")` never list it).
   */
  keeperPage?: boolean;
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

/** URL of the hidden keeper tab (see StagehandFacadeToolsOptions.keeperPage). */
export const FACADE_KEEPER_PAGE_URL = "about:blank";

const FACADE_PRELUDE = `"use strict";
const __stagehandCompatIdentity = (target) => target;
for (let index = 0; index <= 32; index += 1) {
  globalThis[index === 0 ? "__name" : "__name" + index] = __stagehandCompatIdentity;
}
const createRuntime = ${createPlaywrightCompatRuntime.toString()};
const runtime = await createRuntime(batchStagehand, { hiddenPageIds: input.hiddenPageIds ?? [] });
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

type RunInput = { hiddenPageIds?: string[] };

export class StagehandFacadeTools {
  private readonly snapshotsByPage = new Map<string, SnapshotState>();
  private queue: Promise<void> = Promise.resolve();
  private keeper: Promise<string | undefined> | undefined;
  constructor(
    private readonly stagehand: Stagehand,
    private readonly options: StagehandFacadeToolsOptions = {},
  ) {}

  snapshot(options: { includeIframes?: boolean } = {}): Promise<string> {
    return this.enqueue("snapshot", () => this.snapshotNow(options));
  }

  screenshot(
    options: { fullPage?: boolean; type?: "png" | "jpeg"; quality?: number } = {},
  ): Promise<StagehandFacadeScreenshot> {
    return this.enqueue("screenshot", () => this.screenshotNow(options));
  }

  runActions(actions: RefAction[]): Promise<{ completed: number; url: string }> {
    return this.enqueue("run", () => this.runActionsNow(actions));
  }

  run(code: string): Promise<unknown> {
    return this.enqueue("run", () => this.runNow(code));
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
    ) as ExperimentalBatchCallback<RunInput, RunEnvelope>;
    const startedAt = performance.now();
    const keeperPageId = await this.keeper;
    const input: RunInput = keeperPageId ? { hiddenPageIds: [keeperPageId] } : {};
    const envelope = await this.runBatchWithActivePageFallback(callback, input, page);
    this.options.onRunReport?.({
      telemetry: envelope.telemetry,
      batchRoundTripMs: performance.now() - startedAt,
      batchRuntimeMs: envelope.batchRuntimeMs,
      closeRequested: envelope.closeRequested,
    });
    await this.writeScreenshotArtifacts(envelope.artifacts);
    if (envelope.executionError) {
      // Thrown by the agent's own code inside the browser, so its message can
      // never be evidence about this process's connection to the browser.
      const error = new Error(envelope.executionError.message) as Error & {
        facadeExecutionError: true;
      };
      error.name = envelope.executionError.name;
      if (envelope.executionError.stack) error.stack = envelope.executionError.stack;
      error.facadeExecutionError = true;
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
    callback: ExperimentalBatchCallback<RunInput, RunEnvelope>,
    input: RunInput,
    page: Page,
  ): Promise<RunEnvelope> {
    try {
      return await this.stagehand.experimentalBatch(callback, input, {
        page,
        timeout: RUN_BATCH_TIMEOUT_MS,
      });
    } catch (error) {
      if (!(error instanceof Error) || !/callback batch page was not found/iu.test(error.message)) {
        throw error;
      }
      const fallback = await this.activePage();
      return await this.stagehand.experimentalBatch(callback, input, {
        page: fallback,
        timeout: RUN_BATCH_TIMEOUT_MS,
      });
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

  /**
   * The page the agent is working on. A closed or crashed tab leaves the
   * context without an active page (or with only the keeper); the agent then
   * gets a fresh blank page rather than a dead end, and the keeper stays hidden.
   */
  private async activePage(): Promise<Page> {
    const context = this.stagehand.browser.context;
    const keeperPageId = await this.keeper;
    const active = await context.activePage();
    if (active && active.pageId !== keeperPageId) return active;
    const visible = (await context.pages()).filter((page) => page.pageId !== keeperPageId);
    const page = visible[0] ?? (await context.newPage());
    await context.setActivePage(page);
    return page;
  }

  /**
   * Opens the keeper once. A dead transport here is session loss like
   * anywhere else; any other failure just means running without a keeper.
   */
  private async ensureKeeperPage(): Promise<void> {
    this.keeper ??= this.openKeeperPage().catch((error: unknown) => {
      if (sessionLossCause(error) !== undefined) throw error;
      return undefined;
    });
    try {
      await this.keeper;
    } catch (error) {
      this.keeper = Promise.resolve(undefined);
      throw error;
    }
  }

  private async openKeeperPage(): Promise<string | undefined> {
    if (this.options.keeperPage === false) return undefined;
    const context = this.stagehand.browser.context;
    const before = await context.activePage();
    const keeper = await context.newPage(FACADE_KEEPER_PAGE_URL);
    // newPage activates the new tab; hand focus straight back.
    if (before) await context.setActivePage(before);
    return keeper.pageId;
  }

  private enqueue<Result>(_tool: string, operation: () => Promise<Result>): Promise<Result> {
    const execute = async (): Promise<Result> => {
      await this.ensureKeeperPage();
      return operation();
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Maps an error to the reason the browser session is unusable, or undefined
 * when it is an ordinary tool failure the agent can act on. A batch that hit
 * its executor-side timeout is ordinary: the executor answered.
 */
function sessionLossCause(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ((error as { facadeExecutionError?: boolean }).facadeExecutionError) return undefined;
  switch (error.name) {
    case "StagehandBatchTimeoutError": {
      const { clientTimeout } = error as Error & { clientTimeout?: number };
      return typeof clientTimeout === "number"
        ? `batch received no response within ${clientTimeout}ms`
        : "batch received no response before its client deadline";
    }
    // FacadeDeadlineError is intentionally NOT terminal here: a single capture
    // deadline is handled as recoverable in enqueue(), which escalates to
    // session-loss only after repeated consecutive timeouts.
    case "CDPConnectionClosedError":
      return cdpSessionLossCause(error);
  }
  if (/\bCDP connection closed\b/u.test(error.message)) return cdpSessionLossCause(error);
  if (/\bRPC client is closed\b/u.test(error.message)) return "RPC client closed";
  return undefined;
}

function cdpSessionLossCause(error: Error): string {
  const messages = [error.message];
  const seen = new Set<Error>([error]);
  let cause = error.cause;
  // An error before the WebSocket close event carries its diagnostics in cause,
  // while a close event carries them in the outer message. Preserve both paths.
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    const code = (cause as Error & { code?: unknown }).code;
    const label =
      typeof code === "string" || typeof code === "number" ? `${cause.name} [${code}]` : cause.name;
    messages.push(cause.message ? `${label}: ${cause.message}` : label);
    cause = cause.cause;
  }
  return sanitizeErrorMessage(messages.join("; caused by "));
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
