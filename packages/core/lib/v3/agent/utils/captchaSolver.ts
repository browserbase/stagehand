import type { Page } from "../../understudy/page.js";
import type { ConsoleMessage } from "../../understudy/consoleMessage.js";

const SOLVING_STARTED = "browserbase-solving-started";
const SOLVING_FINISHED = "browserbase-solving-finished";
const SOLVING_ERRORED = "browserbase-solving-errored";

/** Maximum time (ms) to wait for the captcha solver before giving up. */
const SOLVE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Shared captcha notification strings
// ---------------------------------------------------------------------------

/** Injected into the agent message stream after a successful captcha solve. */
export const CAPTCHA_SOLVED_MSG =
  "A captcha was automatically detected and solved — no further interaction with the captcha is needed, even if it does not visually appear solved. Do not click the captcha checkbox, widget, or challenge again. Continue with your task.";

/** Injected into the agent message stream when the captcha solver fails. */
export const CAPTCHA_ERRORED_MSG =
  "A captcha was detected but the automatic captcha solver failed to solve it. You may need to try a different approach or navigate around the captcha.";

/** Appended to the system prompt (DOM/hybrid agents) when captchas auto-solve. */
export const CAPTCHA_SYSTEM_PROMPT_NOTE =
  "Captchas on this page are automatically detected and solved by the browser environment. Do not interact with or attempt to solve any captchas yourself — they will be handled for you. Do not click the captcha checkbox, widget, or challenge again after it has been solved, even if it still looks unresolved. Continue with your task as if the captcha does not exist.";

/** Appended to the CUA system prompt when captchas auto-solve. */
export const CAPTCHA_CUA_SYSTEM_PROMPT_NOTE =
  "\n\nCaptchas on this page are automatically detected and solved by the browser environment. Do not interact with or attempt to solve any captchas yourself — they will be handled for you. Continue with your task as if the captcha does not exist.";

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
  private _solvedSinceLastConsume = false;
  private _erroredSinceLastConsume = false;
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

  /** Whether a captcha solve is currently in progress. */
  isSolving(): boolean {
    return this.solving;
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
      } else if (text === SOLVING_FINISHED) {
        this.solving = false;
        this._solvedSinceLastConsume = true;
        this.settle();
      } else if (text === SOLVING_ERRORED) {
        this.solving = false;
        this._erroredSinceLastConsume = true;
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
        this._erroredSinceLastConsume = true;
        this.settle();
      }, SOLVE_TIMEOUT_MS);
    });

    return this.waitPromise;
  }

  /**
   * Returns and resets the solve event flags.
   * Call after `waitIfSolving()` to check whether a captcha was solved
   * (or errored) since the last consume.  This captures events even if
   * the solve completed between two `waitIfSolving()` calls.
   */
  consumeSolveResult(): { solved: boolean; errored: boolean } {
    const result = {
      solved: this._solvedSinceLastConsume,
      errored: this._erroredSinceLastConsume,
    };
    this._solvedSinceLastConsume = false;
    this._erroredSinceLastConsume = false;
    return result;
  }

  /**
   * Remove the console listener and reset all state.
   */
  dispose(): void {
    this.detachListener();
    this.attachedPage = null;
    this.pageProvider = null;
    this.solving = false;
    this._solvedSinceLastConsume = false;
    this._erroredSinceLastConsume = false;
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
    // If a solve was in progress, mark it as errored so consumers
    // know it was interrupted (consistent with the timeout path).
    if (this.solving) {
      this._erroredSinceLastConsume = true;
    }
    // Reset solving state so waiters aren't stuck waiting for events
    // that can never arrive from the detached page.
    this.solving = false;
    this.settle();
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
