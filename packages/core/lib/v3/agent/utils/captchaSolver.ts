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
 * All concurrent callers of `waitIfSolving()` share the same underlying
 * promise, so multiple waiters are safely resolved together.
 */
export class CaptchaSolver {
  private solving = false;
  private _lastSolveErrored = false;
  private listener: ((msg: ConsoleMessage) => void) | null = null;
  private page: Page | null = null;

  /** Shared promise that all concurrent waitIfSolving() callers await. */
  private waitPromise: Promise<void> | null = null;
  /** Resolves the shared waitPromise. */
  private resolveWait: (() => void) | null = null;
  /** Timeout handle for the 90s deadline. */
  private waitTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Attach console listener to the given page. Only one page can be
   * attached at a time — call `dispose()` first to switch pages.
   */
  attach(page: Page): void {
    this.dispose();
    this.page = page;

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
   * All concurrent callers share the same promise, so no waiter is
   * orphaned.
   */
  waitIfSolving(): Promise<void> {
    if (!this.solving) return Promise.resolve();

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
   * Remove the console listener and reset state.
   */
  dispose(): void {
    if (this.page && this.listener) {
      this.page.off("console", this.listener);
    }
    this.listener = null;
    this.page = null;
    this.solving = false;
    this._lastSolveErrored = false;
    this.settle();
  }

  /**
   * Resolve the shared wait promise and clear the timeout.
   */
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
