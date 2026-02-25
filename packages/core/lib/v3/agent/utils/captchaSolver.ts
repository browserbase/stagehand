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
 */
export class CaptchaSolver {
  private solving = false;
  private _lastSolveErrored = false;
  private resolveWait: (() => void) | null = null;
  private listener: ((msg: ConsoleMessage) => void) | null = null;
  private page: Page | null = null;

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
        if (this.resolveWait) {
          this.resolveWait();
          this.resolveWait = null;
        }
      } else if (text === SOLVING_ERRORED) {
        this.solving = false;
        this._lastSolveErrored = true;
        if (this.resolveWait) {
          this.resolveWait();
          this.resolveWait = null;
        }
      }
    };

    page.on("console", this.listener);
  }

  /**
   * Returns a promise that resolves immediately if no captcha is being
   * solved, or blocks until the solver finishes, errors, or the 90s
   * timeout is reached.
   */
  waitIfSolving(): Promise<void> {
    if (!this.solving) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.solving = false;
        this._lastSolveErrored = true;
        if (this.resolveWait) {
          this.resolveWait = null;
        }
        resolve();
      }, SOLVE_TIMEOUT_MS);

      this.resolveWait = () => {
        clearTimeout(timer);
        resolve();
      };
    });
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
    if (this.resolveWait) {
      this.resolveWait();
      this.resolveWait = null;
    }
  }
}
