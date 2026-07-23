import type { Protocol } from "devtools-protocol";
import type { LoadState } from "../../protocol/types.js";
import type { CDPSessionLike } from "./cdp.js";
import type { NetworkManager } from "./networkManager.js";
import type { Page } from "./page.js";
import { TimeoutError } from "../errors.js";
import {
  DEFAULT_IDLE_WAIT,
  IGNORED_RESOURCE_TYPES,
  type NetworkRequestInfo,
  WaitForIdleHandle,
} from "../types/private/network.js";

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
  readonly page: Page;
  readonly mainSession: CDPSessionLike;
  readonly networkManager: NetworkManager;
  readonly waitUntil: LoadState;
  readonly timeout: number;
  readonly startTime: number;
  readonly navigationCommandId: number;
  currentLoaderId: string | undefined;
  idleStartTime: number;

  cleanupCallbacks: Array<() => void> = [];
  idleHandle: WaitForIdleHandle | null = null;

  abortReject: ((error: Error) => void) | null = null;
  abortPromise: Promise<never>;
  abortError: Error | null = null;
  disposed = false;

  expectedLoaderId: string | undefined;
  initialLoaderId: string | undefined;
  pendingFollowupNavigation = false;

  /**
   * Create a watcher; callers should subsequently invoke {@link wait}.
   */
  constructor(params: {
    page: Page;
    mainSession: CDPSessionLike;
    networkManager: NetworkManager;
    waitUntil: LoadState;
    timeout: number;
    navigationCommandId: number;
  }) {
    this.page = params.page;
    this.mainSession = params.mainSession;
    this.networkManager = params.networkManager;
    this.waitUntil = params.waitUntil;
    this.timeout = params.timeout;
    this.startTime = Date.now();
    this.navigationCommandId = params.navigationCommandId;
    this.idleStartTime = this.startTime;

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
    this.currentLoaderId = loaderId;
    this.idleStartTime = Date.now();
  }

  /** Wait for the requested lifecycle state or throw on timeout/abort. */
  public async wait(): Promise<void> {
    const deadline = Date.now() + this.timeout;

    try {
      if (this.waitUntil === "domcontentloaded") {
        await this.awaitWithAbort(
          this.page.waitForMainLoadState("domcontentloaded", this.timeRemaining(deadline)),
        );
        return;
      }

      while (true) {
        await this.awaitWithAbort(
          this.page.waitForMainLoadState("load", this.timeRemaining(deadline)),
        );

        if (this.waitUntil !== "networkidle") break;

        try {
          await this.awaitWithAbort(this.waitForNetworkIdle(deadline));
          break;
        } catch (error) {
          if (this.shouldRestartAfterFollowup(error)) {
            continue;
          }
          throw error;
        }
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
  installSessionListeners(): void {
    const onFrameNavigated = (evt: Protocol.Page.FrameNavigatedEvent) => {
      if (!evt?.frame?.id) return;

      const mainFrameId = this.page.mainFrameId();
      if (evt.frame.id !== mainFrameId) return;

      const loaderId = evt.frame.loaderId;
      if (!loaderId) return;

      if (!this.initialLoaderId) {
        this.initialLoaderId = loaderId;
        this.currentLoaderId = loaderId;
        this.idleStartTime = Date.now();
      }

      if (!this.expectedLoaderId) {
        this.expectedLoaderId = loaderId;
        this.currentLoaderId = loaderId;
        this.idleStartTime = Date.now();
        return;
      }

      if (loaderId !== this.expectedLoaderId) {
        if (!this.page.isCurrentNavigationCommand(this.navigationCommandId)) {
          this.triggerAbort(new Error("Navigation was superseded by a new request"));
          return;
        }

        this.adoptNewMainLoader(loaderId);
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
    if (this.abortReject) {
      this.abortReject(error);
      this.abortReject = null;
    }
  }
  waitForNetworkIdle(deadline: number): Promise<void> {
    this.pendingFollowupNavigation = false;
    const remaining = this.timeRemaining(deadline);
    const idleWindow = Math.min(DEFAULT_IDLE_WAIT, remaining);
    this.idleHandle = this.networkManager.waitForIdle({
      startTime: this.idleStartTime,
      timeout: remaining,
      totalBudgetMs: this.timeout,
      idleTimeMs: idleWindow,
      filter: this.buildIdleFilter(),
    });

    return this.idleHandle.promise.catch((error) => {
      if (this.abortError) throw this.abortError;
      throw error;
    });
  }

  shouldRestartAfterFollowup(error: unknown): boolean {
    if (!this.pendingFollowupNavigation) return false;
    if (!(error instanceof Error)) return false;
    if (error.message !== "waitForIdle disposed") return false;
    this.pendingFollowupNavigation = false;
    return true;
  }

  adoptNewMainLoader(loaderId: string): void {
    this.expectedLoaderId = loaderId;
    this.currentLoaderId = loaderId;
    this.idleStartTime = Date.now();
    if (this.waitUntil !== "networkidle") return;

    this.pendingFollowupNavigation = true;

    if (this.idleHandle) {
      const handle = this.idleHandle;
      this.idleHandle = null;
      void handle.promise.catch(() => {});
      handle.dispose();
    }
  }

  buildIdleFilter(): (info: NetworkRequestInfo) => boolean {
    const loaderId = this.currentLoaderId;
    const mainFrameId = this.page.mainFrameId();

    return (info: NetworkRequestInfo) => {
      if (IGNORED_RESOURCE_TYPES.has(info.resourceType)) return false;

      if (loaderId && info.loaderId) {
        return info.loaderId === loaderId;
      }

      if (!info.loaderId && info.frameId) {
        return info.frameId === mainFrameId;
      }

      return true;
    };
  }
}
