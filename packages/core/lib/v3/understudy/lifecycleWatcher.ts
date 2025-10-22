import type { Protocol } from "devtools-protocol";
import type { LoadState } from "../types/public/page";
import type { CDPSessionLike } from "./cdp";
import type { NetworkManager } from "./networkManager";
import type { Page } from "./page";
import { WaitForIdleHandle } from "../types/private/network";

/**
 * Coordinates page lifecycle waits (load/domcontentloaded/networkidle) while
 * following main-frame swaps and navigation aborts. Each navigation spawns a
 * one-off watcher that listens for relevant CDP events and resolves or rejects
 * depending on the requested `waitUntil` state.
 */

/**
 * Small utility that mirrors Playwright's lifecycle watcher semantics. Bridges
 * main-frame lifecycle events with the NetworkManager's idle signal so callers
 * can await `load`, `domcontentloaded`, or `networkidle` with a single promise.
 */
export class LifecycleWatcher {
  private readonly page: Page;
  private readonly mainSession: CDPSessionLike;
  private readonly networkManager: NetworkManager;
  private readonly waitUntil: LoadState;
  private readonly timeoutMs: number;
  private readonly startTime: number;

  private cleanupCallbacks: Array<() => void> = [];
  private idleHandle: WaitForIdleHandle | null = null;

  private abortReject: ((error: Error) => void) | null = null;
  private abortPromise: Promise<never>;
  private abortError: Error | null = null;
  private disposed = false;

  private expectedLoaderId: string | undefined;
  private initialLoaderId: string | undefined;

  /**
   * Create a watcher; callers should subsequently invoke {@link wait}.
   */
  constructor(params: {
    page: Page;
    mainSession: CDPSessionLike;
    networkManager: NetworkManager;
    waitUntil: LoadState;
    timeoutMs: number;
  }) {
    this.page = params.page;
    this.mainSession = params.mainSession;
    this.networkManager = params.networkManager;
    this.waitUntil = params.waitUntil;
    this.timeoutMs = params.timeoutMs;
    this.startTime = Date.now();

    this.abortPromise = new Promise<never>((_, reject) => {
      this.abortReject = reject;
    });

    this.installSessionListeners();
  }

  /** Hint the watcher with the loader id returned by Page.navigate. */
  public setExpectedLoaderId(loaderId: string | undefined): void {
    if (!loaderId) return;
    this.expectedLoaderId = loaderId;
    this.initialLoaderId = loaderId;
  }

  /** Wait for the requested lifecycle state or throw on timeout/abort. */
  public async wait(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;

    try {
      if (this.waitUntil === "domcontentloaded") {
        await this.awaitWithAbort(
          this.page.waitForMainLoadState(
            "domcontentloaded",
            this.timeRemaining(deadline),
          ),
        );
        return;
      }

      await this.awaitWithAbort(
        this.page.waitForMainLoadState("load", this.timeRemaining(deadline)),
      );

      if (this.waitUntil === "networkidle") {
        this.idleHandle = this.networkManager.waitForIdle({
          startTime: this.startTime,
          timeoutMs: this.timeRemaining(deadline),
          totalBudgetMs: this.timeoutMs,
        });

        await this.awaitWithAbort(
          this.idleHandle.promise.catch((error) => {
            // Surface timeout / disposal errors unless we already aborted.
            if (this.abortError) throw this.abortError;
            throw error;
          }),
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

    if (this.idleHandle) {
      void this.idleHandle.promise.catch(() => {});
      this.idleHandle.dispose();
      this.idleHandle = null;
    }

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
  private installSessionListeners(): void {
    const onFrameNavigated = (evt: Protocol.Page.FrameNavigatedEvent) => {
      if (!evt?.frame?.id) return;

      const mainFrameId = this.page.mainFrameId();
      if (evt.frame.id !== mainFrameId) return;

      const loaderId = evt.frame.loaderId;
      if (!loaderId) return;

      if (!this.initialLoaderId) {
        this.initialLoaderId = loaderId;
      }

      if (!this.expectedLoaderId) {
        this.expectedLoaderId = loaderId;
        return;
      }

      if (loaderId !== this.expectedLoaderId) {
        this.triggerAbort(
          new Error("Navigation was superseded by a new request"),
        );
      }
    };

    const onFrameDetached = (evt: Protocol.Page.FrameDetachedEvent) => {
      if (!evt?.frameId) return;
      const mainFrameId = this.page.mainFrameId();
      if (evt.frameId !== mainFrameId) return;
      if (evt.reason === "swap") return;
      this.triggerAbort(new Error("Main frame was detached"));
    };

    this.mainSession.on("Page.frameNavigated", onFrameNavigated);
    this.cleanupCallbacks.push(() => {
      this.mainSession.off("Page.frameNavigated", onFrameNavigated);
    });

    this.mainSession.on("Page.frameDetached", onFrameDetached);
    this.cleanupCallbacks.push(() => {
      this.mainSession.off("Page.frameDetached", onFrameDetached);
    });
  }

  /** Compute remaining time until the shared deadline elapses. */
  private timeRemaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Lifecycle wait timed out after ${this.timeoutMs}ms`);
    }
    return remaining;
  }

  /** Await an operation but abort early if navigation replacement fires. */
  private async awaitWithAbort<T>(operation: Promise<T>): Promise<T> {
    try {
      return await Promise.race([operation, this.abortPromise]);
    } catch (error) {
      if (this.abortError) throw this.abortError;
      throw error;
    }
  }

  /** Mark the watcher as aborted and reject any pending waiters. */
  private triggerAbort(error: Error): void {
    if (this.abortError) return;
    this.abortError = error;
    if (this.abortReject) {
      this.abortReject(error);
      this.abortReject = null;
    }
  }
}
