import fsp from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { ExperimentalBatchCallback, Page, Stagehand } from "@browserbasehq/stagehand";
import { sanitizeErrorMessage } from "../harness/redact.js";
import {
  browserSessionLostError,
  FACADE_BROWSER_CLOSED_ERROR,
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  RefActionSchema,
  RUN_RESULT_LIMITS,
  RUN_RESULT_MALFORMED_ERROR,
  RUN_VALUE_SIZE_ERROR,
  SCREENSHOT_ARTIFACT_COUNT_ERROR,
  SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR,
  SCREENSHOT_ARTIFACT_PATH_ERROR,
  SCREENSHOT_ARTIFACT_SIZE_ERROR,
  SCREENSHOT_ARTIFACT_SYMLINK_ERROR,
  SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR,
  staleSnapshotIdError,
  type FacadeSessionLoss,
  type RefAction,
} from "./contract.js";
import {
  actionRunner,
  runCallback,
  type RunEnvelope,
  type RunInput,
  type ScreenshotArtifact,
} from "./batch-sources.js";
import type { PlaywrightCompatTelemetry } from "./runtime.js";

type SnapshotState = { url: string; xpathById: Record<string, string> };

export type StagehandFacadeRunReport = {
  telemetry: PlaywrightCompatTelemetry;
  /** Wall-clock time of the whole experimentalBatch round trip. */
  batchRoundTripMs: number;
  /** Time the agent's code spent executing inside the batch. */
  batchRuntimeMs: number;
  closeRequested: boolean;
};

export class StagehandFacadeCleanupError extends Error {
  override readonly name = "StagehandFacadeCleanupError";

  constructor() {
    super("Failed to close the Stagehand browser session.");
  }
}

export class StagehandFacadeInputError extends Error {
  override readonly name = "StagehandFacadeInputError";

  constructor(message: string) {
    super(sanitizeErrorMessage(message));
  }
}

export class StagehandFacadeExecutionError extends Error {
  readonly facadeExecutionError = true;

  constructor(error: { name: string; message: string }) {
    super(sanitizeErrorMessage(error.message));
    const name = sanitizeErrorMessage(error.name);
    this.name = /^[A-Za-z][A-Za-z0-9]*Error$/u.test(name) ? name : "Error";
    this.stack = undefined;
  }
}

export type StagehandFacadeToolsOptions = {
  /** Replaces default cleanup when the host owns session release and replacement. */
  onCloseRequested?: () => Promise<void>;
  /** Owned directory for screenshot artifacts; paths must stay within it. Defaults to process.cwd(). */
  artifactRoot?: string;
  /** Observes every completed `run` batch (including ones whose code threw). */
  onRunReport?: (report: StagehandFacadeRunReport) => void;
  /** Fires once, the first time a call proves the browser session is gone. */
  onSessionLost?: (loss: FacadeSessionLoss) => void;
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

/** Every facade tool returns this once the browser session is gone. */
export class StagehandFacadeSessionLostError extends Error {
  override readonly name = "StagehandFacadeSessionLostError";
  constructor(readonly loss: FacadeSessionLoss) {
    super(browserSessionLostError(loss.cause));
  }
}

const RUN_BATCH_TIMEOUT_MS = 60_000;
/**
 * snapshot/screenshot RPCs have no executor-side deadline. Calls are serialized,
 * so one that never answers must release the queue at a bounded deadline.
 * Repeated capture deadlines latch terminal loss; no underlying RPC is retried.
 */
const PAGE_CAPTURE_DEADLINE_MS = 120_000;

export type StagehandFacadeScreenshot = {
  data: string;
  mimeType: "image/png" | "image/jpeg";
};

/** URL of the hidden keeper tab (see StagehandFacadeToolsOptions.keeperPage). */
export const FACADE_KEEPER_PAGE_URL = "about:blank";

export class StagehandFacadeTools {
  private readonly snapshotsByPage = new Map<string, SnapshotState>();
  private queue: Promise<void> = Promise.resolve();
  private loss: FacadeSessionLoss | undefined;
  private keeper: Promise<string | undefined> | undefined;
  // Consecutive capture-deadline timeouts; reset by any successful tool call.
  // Three consecutive failures end this facade; this does not prove transport loss.
  private consecutiveDeadlines = 0;
  private static readonly MAX_CONSECUTIVE_DEADLINES = 3;

  private closed = false;
  private closePromise: Promise<void> | undefined;
  constructor(
    private readonly stagehand: Stagehand,
    private readonly options: StagehandFacadeToolsOptions = {},
  ) {}

  /** Set once a call has proven the browser session is gone; never cleared. */
  get sessionLoss(): FacadeSessionLoss | undefined {
    return this.loss;
  }

  /** Closes both the client and its owned browser, including keep-alive sessions. */
  close(): Promise<void> {
    this.closed = true;
    return (this.closePromise ??= (async () => {
      if (this.options.onCloseRequested) {
        try {
          await this.options.onCloseRequested();
        } catch {
          throw new StagehandFacadeCleanupError();
        }
        return;
      }
      let failed = false;
      for (const close of [() => this.stagehand.close(), () => this.stagehand.browser.close()]) {
        try {
          await close();
        } catch {
          failed = true;
        }
      }
      if (failed) throw new StagehandFacadeCleanupError();
    })());
  }

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
    // Failed captures invalidate the preceding snapshot too. A late response
    // must never replace the IDs installed by a subsequent successful capture.
    this.snapshotsByPage.delete(page.pageId);
    const { snapshot, url } = await withDeadline(
      (async () => {
        // `page.snapshot` defaults to a 20s timeout. Disable it so the capture
        // deadline below owns the wait; otherwise a slow snapshot fails as an
        // ordinary tool error and never counts toward terminal session loss.
        const snapshot = await page.snapshot({
          includeIframes: options.includeIframes ?? true,
          timeout: 0,
        });
        return { snapshot, url: await page.url() };
      })(),
      PAGE_CAPTURE_DEADLINE_MS,
      "page.snapshot",
    );
    this.snapshotsByPage.set(page.pageId, { url, xpathById: { ...snapshot.xpathMap } });
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
    const bytes = await withDeadline(
      page.screenshot({
        type,
        ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
        ...(quality === undefined ? {} : { quality }),
      }),
      PAGE_CAPTURE_DEADLINE_MS,
      "page.screenshot",
    );
    return {
      data: Buffer.from(bytes).toString("base64"),
      mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
    };
  }

  private async runActionsNow(actions: RefAction[]): Promise<{ completed: number; url: string }> {
    const parsed = RefActionSchema.array().min(1).parse(actions);
    const page = await this.activePage();
    const snapshot = this.snapshotsByPage.get(page.pageId);
    if (!snapshot) throw new StagehandFacadeInputError(NO_HYDRATED_SNAPSHOT_ERROR);

    if ((await page.url()) !== snapshot.url) {
      this.snapshotsByPage.delete(page.pageId);
      throw new StagehandFacadeInputError(NAVIGATED_SNAPSHOT_ERROR);
    }

    // The callback can already have dispatched earlier actions when one fails.
    // Never replay an action batch after a partial failure.
    const result = await this.stagehand.experimentalBatch(
      actionRunner,
      { actions: parsed, xpathById: snapshot.xpathById },
      { page, timeout: RUN_BATCH_TIMEOUT_MS },
    );
    if (result?.staleId !== undefined) {
      throw new StagehandFacadeInputError(staleSnapshotIdError(result.staleId));
    }
    return { completed: result?.completed ?? parsed.length, url: await page.url() };
  }

  private async runNow(code: string): Promise<unknown> {
    const page = await this.activePage();
    const callback = runCallback(code);
    const startedAt = performance.now();
    const keeperPageId = await this.keeper;
    const input: RunInput = keeperPageId ? { hiddenPageIds: [keeperPageId] } : {};
    const envelope = await this.runBatchWithActivePageFallback(callback, input, page);
    // Agent code runs inside the callback that builds this result, so it is not
    // acted on (no artifacts, no close) unless it has the envelope's shape.
    if (!isRunEnvelope(envelope)) throw new StagehandFacadeInputError(RUN_RESULT_MALFORMED_ERROR);
    let runError: unknown;
    let runFailed = false;
    try {
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
        throw new StagehandFacadeExecutionError(envelope.executionError);
      }
      const valueBytes = Buffer.byteLength(JSON.stringify(envelope.value) ?? "");
      if (valueBytes > RUN_RESULT_LIMITS.maxValueBytes) {
        throw new StagehandFacadeInputError(RUN_VALUE_SIZE_ERROR);
      }
    } catch (error) {
      runError = error;
      runFailed = true;
    }
    // Wait until the batch finishes before closing its transport, even when
    // agent code, telemetry, or artifact persistence failed.
    if (envelope.closeRequested) {
      try {
        await this.close();
      } catch (closeError) {
        if (runFailed) {
          throw new AggregateError([runError, closeError], "Run failed and cleanup also failed.");
        }
        throw closeError;
      }
    }
    if (runFailed) throw runError;
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
  ): Promise<unknown> {
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
    if (artifacts.length === 0) return;
    // Enforce every cap before the first write so an oversized run saves nothing.
    if (artifacts.length > RUN_RESULT_LIMITS.maxArtifacts) {
      throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_COUNT_ERROR);
    }
    let totalBytes = 0;
    const decoded = artifacts.map((artifact) => {
      const bytes = Buffer.from(artifact.base64, "base64");
      if (bytes.length > RUN_RESULT_LIMITS.maxArtifactBytes) {
        throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_SIZE_ERROR);
      }
      totalBytes += bytes.length;
      if (totalBytes > RUN_RESULT_LIMITS.maxTotalArtifactBytes) {
        throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR);
      }
      return { path: artifact.path, bytes };
    });
    const configuredRoot = path.resolve(this.options.artifactRoot ?? process.cwd());
    await fsp.mkdir(configuredRoot, { recursive: true });
    const root = await fsp.realpath(configuredRoot);
    for (const artifact of decoded) {
      const target = path.resolve(configuredRoot, artifact.path);
      const relative = path.relative(configuredRoot, target);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_PATH_ERROR);
      }
      // Reject symlink traversal before creating nested directories or opening
      // the output. O_NOFOLLOW also refuses an existing symlink at the file.
      let directory = root;
      const components = relative.split(path.sep);
      for (const component of components.slice(0, -1)) {
        directory = path.join(directory, component);
        await fsp.mkdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
        if (!(await fsp.lstat(directory)).isDirectory()) {
          throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_SYMLINK_ERROR);
        }
      }
      const file = await fsp
        .open(
          path.join(directory, components.at(-1)!),
          constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
          0o600,
        )
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ELOOP") {
            throw new StagehandFacadeInputError(SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR);
          }
          throw error;
        });
      try {
        await file.writeFile(artifact.bytes);
      } finally {
        await file.close();
      }
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

  private enqueue<Result>(tool: string, operation: () => Promise<Result>): Promise<Result> {
    const guarded = async (): Promise<Result> => {
      if (this.loss) throw new StagehandFacadeSessionLostError(this.loss);
      if (this.closed) throw new StagehandFacadeInputError(FACADE_BROWSER_CLOSED_ERROR);
      try {
        await this.ensureKeeperPage();
        const value = await operation();
        this.consecutiveDeadlines = 0; // a real response proves the session is alive
        return value;
      } catch (error) {
        // Permit two consecutive capture timeouts. The deadline does not cancel
        // the underlying RPC, and recovery never replays that capture or an action.
        if (error instanceof FacadeDeadlineError) {
          this.consecutiveDeadlines += 1;
          if (this.consecutiveDeadlines < StagehandFacadeTools.MAX_CONSECUTIVE_DEADLINES) {
            throw error;
          }
          const cause = `executor unresponsive: ${this.consecutiveDeadlines} consecutive capture timeouts (last: ${error.message})`;
          this.loss = { cause, tool, at: new Date().toISOString() };
          this.notifySessionLost(this.loss);
          throw new StagehandFacadeSessionLostError(this.loss);
        }
        const cause = sessionLossCause(error);
        if (cause === undefined) throw error;
        this.loss = { cause, tool, at: new Date().toISOString() };
        this.notifySessionLost(this.loss);
        throw new StagehandFacadeSessionLostError(this.loss);
      }
    };
    const result = this.queue.then(guarded, guarded);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private notifySessionLost(loss: FacadeSessionLoss): void {
    // Diagnostic observers cannot replace the terminal error or reopen the queue.
    try {
      void Promise.resolve(this.options.onSessionLost?.(loss)).catch(() => undefined);
    } catch {
      // Preserve the first browser failure when an observer throws synchronously.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunEnvelope(value: unknown): value is RunEnvelope {
  if (!isRecord(value) || value.__stagehandPlaywrightCompat !== true) return false;
  const { executionError, artifacts } = value;
  return (
    typeof value.closeRequested === "boolean" &&
    typeof value.batchRuntimeMs === "number" &&
    isRecord(value.telemetry) &&
    Array.isArray(artifacts) &&
    artifacts.every(
      (artifact) =>
        isRecord(artifact) &&
        typeof artifact.path === "string" &&
        typeof artifact.base64 === "string",
    ) &&
    (executionError === undefined ||
      executionError === null ||
      (isRecord(executionError) &&
        typeof executionError.name === "string" &&
        typeof executionError.message === "string" &&
        (executionError.stack === undefined || typeof executionError.stack === "string")))
  );
}

class FacadeDeadlineError extends Error {
  override readonly name = "FacadeDeadlineError";
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} received no response within ${timeoutMs}ms`);
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new FacadeDeadlineError(operation, timeoutMs)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
