import type { Protocol } from "devtools-protocol";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
import type { CDPSessionLike } from "./cdp.js";
import type { Page } from "./page.js";
import { TimeoutError } from "../errors.js";
import { waitForMainNetworkIdle } from "./networkIdle.js";
import { runWithProgress } from "./progress.js";

/**
 * Wait for navigation to begin, then await its requested load state.
 * Network-idle tracking is shared with Page.waitForLoadState; this watcher owns
 * navigation-specific events and cancellation when another command supersedes it.
 */
export class LifecycleWatcher {
  readonly page: Page;
  readonly mainSession: CDPSessionLike;
  readonly waitUntil: LoadState;
  readonly timeout: number;
  readonly navigationCommandId: number;

  cleanupCallbacks: Array<() => void> = [];

  abortReject: ((error: Error) => void) | null = null;
  abortPromise: Promise<never>;
  abortError: Error | null = null;
  readonly abortController = new AbortController();
  disposed = false;

  navigationStarted = false;
  sameDocumentNavigation = false;
  resolveNavigationStart!: (sameDocument: boolean) => void;
  navigationStartPromise: Promise<boolean>;

  /**
   * Create a watcher; callers should subsequently invoke {@link wait}.
   */
  constructor(params: {
    page: Page;
    mainSession: CDPSessionLike;
    waitUntil: LoadState;
    timeout: number;
    navigationCommandId: number;
  }) {
    this.page = params.page;
    this.mainSession = params.mainSession;
    this.waitUntil = params.waitUntil;
    this.timeout = params.timeout;
    this.navigationCommandId = params.navigationCommandId;

    this.abortPromise = new Promise<never>((_, reject) => {
      this.abortReject = reject;
    });
    void this.abortPromise.catch(() => {});
    this.navigationStartPromise = new Promise<boolean>((resolve) => {
      this.resolveNavigationStart = (sameDocument) => {
        if (this.navigationStarted) return;
        this.navigationStarted = true;
        this.sameDocumentNavigation = sameDocument;
        resolve(sameDocument);
      };
    });

    this.installSessionListeners();
  }

  /** Wait for the requested lifecycle state or throw on timeout/abort. */
  public async wait(): Promise<void> {
    const deadline = Date.now() + this.timeout;

    try {
      const sameDocument = await this.awaitNavigationStart(deadline);
      if (sameDocument && this.waitUntil !== "networkidle") return;

      if (this.waitUntil === "networkidle") {
        await this.awaitWithAbort(
          runWithProgress(
            { name: "networkidle", timeout: this.timeRemaining(deadline) },
            (progress) => waitForMainNetworkIdle(this.page, progress, this.abortController.signal),
          ),
        );
      } else {
        await this.awaitWithAbort(
          this.page.waitForMainLoadState(
            this.waitUntil,
            this.timeRemaining(deadline),
            this.abortController.signal,
          ),
        );
      }
    } finally {
      this.dispose();
    }

    if (this.abortError) throw this.abortError;
  }

  /** Cancel any outstanding network-idle waits and remove event listeners. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.abortController.abort(new Error("Lifecycle wait disposed"));

    for (const fn of this.cleanupCallbacks) {
      try {
        fn();
      } catch {
        // ignore listener cleanup errors
      }
    }
    this.cleanupCallbacks = [];
    this.abortReject = null;
  }

  /** Subscribe to main-frame events to detect abort conditions. */
  installSessionListeners(): void {
    const onFrameNavigated = (evt: Protocol.Page.FrameNavigatedEvent) => {
      if (!evt?.frame?.id) return;

      const mainFrameId = this.page.mainFrameId();
      if (evt.frame.id !== mainFrameId) return;

      const loaderId = evt.frame.loaderId;
      if (!loaderId) return;
      if (!this.page.isCurrentNavigationCommand(this.navigationCommandId)) {
        this.triggerAbort(new Error("Navigation was superseded by a new request"));
        return;
      }
      this.resolveNavigationStart(false);
    };

    const onFrameDetached = (evt: Protocol.Page.FrameDetachedEvent) => {
      if (!evt?.frameId) return;
      const mainFrameId = this.page.mainFrameId();
      if (evt.frameId !== mainFrameId) return;
      if (evt.reason === "swap") return;
      this.triggerAbort(new Error("Main frame was detached"));
    };

    const onNavigatedWithinDocument = (evt: Protocol.Page.NavigatedWithinDocumentEvent) => {
      if (evt?.frameId !== this.page.mainFrameId()) return;
      if (!this.page.isCurrentNavigationCommand(this.navigationCommandId)) {
        this.triggerAbort(new Error("Navigation was superseded by a new request"));
        return;
      }
      this.resolveNavigationStart(true);
    };

    this.mainSession.on("Page.frameNavigated", onFrameNavigated);
    this.cleanupCallbacks.push(() => {
      this.mainSession.off("Page.frameNavigated", onFrameNavigated);
    });

    this.mainSession.on("Page.frameDetached", onFrameDetached);
    this.cleanupCallbacks.push(() => {
      this.mainSession.off("Page.frameDetached", onFrameDetached);
    });

    this.mainSession.on("Page.navigatedWithinDocument", onNavigatedWithinDocument);
    this.cleanupCallbacks.push(() => {
      this.mainSession.off("Page.navigatedWithinDocument", onNavigatedWithinDocument);
    });
  }

  /** Wait for a new-document or same-document main-frame navigation to begin. */
  async awaitNavigationStart(deadline: number): Promise<boolean> {
    if (this.navigationStarted) return this.sameDocumentNavigation;

    const remaining = this.timeRemaining(deadline);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError("Navigation start", this.timeout));
      }, remaining);
    });

    try {
      return await this.awaitWithAbort(Promise.race([this.navigationStartPromise, timeoutPromise]));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Compute remaining time until the shared deadline elapses. */
  timeRemaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new TimeoutError("Lifecycle wait", this.timeout);
    }
    return remaining;
  }

  /** Await an operation but abort early if navigation replacement fires. */
  async awaitWithAbort<T>(operation: Promise<T>): Promise<T> {
    try {
      return await Promise.race([operation, this.abortPromise]);
    } catch (error) {
      if (this.abortError) throw this.abortError;
      throw error;
    }
  }

  /** Mark the watcher as aborted and reject any pending waiters. */
  triggerAbort(error: Error): void {
    if (this.abortError) return;
    this.abortError = error;
    this.abortController.abort(error);
    if (this.abortReject) {
      this.abortReject(error);
      this.abortReject = null;
    }
  }
}
