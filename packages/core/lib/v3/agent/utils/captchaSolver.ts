import type { Page } from "../../understudy/page.js";
import type { ConsoleMessage } from "../../understudy/consoleMessage.js";

const SOLVING_STARTED = "browserbase-solving-started";
const SOLVING_FINISHED = "browserbase-solving-finished";
const SOLVING_ERRORED = "browserbase-solving-errored";

/** Maximum time (ms) to wait for the captcha solver before giving up. */
const SOLVE_TIMEOUT_MS = 90_000;

/**
 * Tracks Browserbase captcha solver state via console messages and provides
 * a blocking `waitIfSolving()` that agents call before each step/action.
 *
 * Accepts a page-provider callback so the listener is automatically
 * re-attached when the active page changes (e.g. popup / new tab).
 *
 * All concurrent callers of `waitIfSolving()` share the same underlying
 * promise, so multiple waiters are safely resolved together.
 */
export class CaptchaSolver {
  private solving = false;
  private _lastSolveErrored = false;
  private listener: ((msg: ConsoleMessage) => void) | null = null;
  private attachedPage: Page | null = null;
  private pageProvider: (() => Promise<Page>) | null = null;

  /** Shared promise that all concurrent waitIfSolving() callers await. */
  private waitPromise: Promise<void> | null = null;
  /** Resolves the shared waitPromise. */
  private resolveWait: (() => void) | null = null;
  /** Timeout handle for the 90s deadline. */
  private waitTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialise with a callback that returns the current active page.
   * The listener is lazily (re-)attached whenever the active page changes.
   */
  init(pageProvider: () => Promise<Page>): void {
    this.pageProvider = pageProvider;
  }

  /**
   * Ensure the console listener is attached to the current active page.
   * If the active page has changed since the last call, the old listener
   * is removed and a new one is installed.
   */
  async ensureAttached(): Promise<void> {
    if (!this.pageProvider) return;
    const page = await this.pageProvider();
    if (page === this.attachedPage) return;

    // Detach from the old page
    this.detachListener();

    this.attachedPage = page;
    this.listener = (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text === SOLVING_STARTED) {
        this.solving = true;
        this._lastSolveErrored = false;
      } else if (text === SOLVING_FINISHED) {
        this.solving = false;
        this._lastSolveErrored = false;
        this.settle();
      } else if (text === SOLVING_ERRORED) {
        this.solving = false;
        this._lastSolveErrored = true;
        this.settle();
      }
    };
    page.on("console", this.listener);
  }

  /**
   * Returns a promise that resolves immediately if no captcha is being
   * solved, or blocks until the solver finishes, errors, or the 90s
   * timeout is reached.
   *
   * Also re-attaches the listener to the current active page if it has
   * changed since the last call.
   *
   * All concurrent callers share the same promise, so no waiter is
   * orphaned.
   */
  async waitIfSolving(): Promise<void> {
    await this.ensureAttached();

    if (!this.solving) return;

    // Return the existing shared promise if one is already pending
    if (this.waitPromise) return this.waitPromise;

    this.waitPromise = new Promise<void>((resolve) => {
      this.resolveWait = resolve;
      this.waitTimer = setTimeout(() => {
        this.solving = false;
        this._lastSolveErrored = true;
        this.settle();
      }, SOLVE_TIMEOUT_MS);
    });

    return this.waitPromise;
  }

  /**
   * Whether the most recent captcha solve attempt errored.
   * Resets to false when a new solve starts or `resetError()` is called.
   */
  get lastSolveErrored(): boolean {
    return this._lastSolveErrored;
  }

  /**
   * Clear the error flag after consuming it.
   */
  resetError(): void {
    this._lastSolveErrored = false;
  }

  /**
   * Remove the console listener and reset all state.
   */
  dispose(): void {
    this.detachListener();
    this.attachedPage = null;
    this.pageProvider = null;
    this.solving = false;
    this._lastSolveErrored = false;
    this.settle();
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Remove the console listener from the currently attached page. */
  private detachListener(): void {
    if (this.attachedPage && this.listener) {
      this.attachedPage.off("console", this.listener);
    }
    this.listener = null;
  }

  /** Resolve the shared wait promise and clear the timeout. */
  private settle(): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.resolveWait) {
      const resolve = this.resolveWait;
      this.resolveWait = null;
      this.waitPromise = null;
      resolve();
    }
  }
}
