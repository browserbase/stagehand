import type { Protocol } from "devtools-protocol";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
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

export class LifecycleWatcher {
  readonly page: Page;
  readonly mainSession: CDPSessionLike;
  readonly networkManager: NetworkManager;
  readonly waitUntil: LoadState;
  readonly timeout: number;
  readonly startTime: number;
  readonly navigationCommandId: number | undefined;
  currentLoaderId: string | undefined;
  idleStartTime: number;

  cleanupCallbacks: Array<() => void> = [];
  idleHandle: WaitForIdleHandle | null = null;

  abortReject: ((error: Error) => void) | null = null;
  abortPromise: Promise<never>;
  abortError: Error | null = null;
  disposed = false;
  private waitCompleted = false;

  expectedLoaderId: string | undefined;
  initialLoaderId: string | undefined;
  pendingFollowupNavigation = false;
  navigationStarted = false;
  sameDocumentNavigation = false;
  resolveNavigationStart!: (sameDocument: boolean) => void;
  navigationStartPromise: Promise<boolean>;

  constructor(params: {
    page: Page;
    mainSession: CDPSessionLike;
    networkManager: NetworkManager;
    waitUntil: LoadState;
    timeout: number;
    navigationCommandId?: number;
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
    void this.abortPromise.catch(() => {});
    this.navigationStartPromise = new Promise<boolean>((resolve) => {
      this.resolveNavigationStart = (sameDocument) => {
        if (this.navigationStarted) return;
        this.navigationStarted = true;
        this.sameDocumentNavigation = sameDocument;
        resolve(sameDocument);
      };
    });

    if (this.navigationCommandId === undefined) {
      const loaderId = this.page.registry.frames.get(this.page.mainFrameId())?.lastSeen?.loaderId;
      this.setExpectedLoaderId(loaderId);
      if (loaderId) this.idleStartTime = 0;
      this.resolveNavigationStart(false);
    }

    this.installSessionListeners();
  }

  public setExpectedLoaderId(loaderId: string | undefined): void {
    if (!loaderId) return;
    this.expectedLoaderId = loaderId;
    this.initialLoaderId = loaderId;
    this.currentLoaderId = loaderId;
    this.idleStartTime = Date.now();
  }

  public async wait(): Promise<void> {
    const deadline = Date.now() + this.timeout;

    try {
      if (this.abortError) throw this.abortError;
      if (this.disposed) throw new Error("LifecycleWatcher was disposed");

      const sameDocument = await this.awaitNavigationStart(deadline);
      if (this.abortError) throw this.abortError;
      if (sameDocument) {
        this.waitCompleted = true;
        return;
      }

      if (this.waitUntil === "domcontentloaded") {
        await this.waitForMainLoadState("domcontentloaded", deadline);
        if (this.abortError) throw this.abortError;
        this.waitCompleted = true;
        return;
      }

      while (true) {
        this.pendingFollowupNavigation = false;
        await this.waitForMainLoadState("load", deadline);

        if (this.waitUntil !== "networkidle") break;
        if (this.pendingFollowupNavigation) continue;

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

      if (this.abortError) throw this.abortError;
      this.waitCompleted = true;
    } finally {
      this.dispose();
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (!this.waitCompleted) {
      this.triggerAbort(new Error("LifecycleWatcher was disposed"));
    }

    if (this.idleHandle) {
      void this.idleHandle.promise.catch(() => {});
      this.idleHandle.dispose();
      this.idleHandle = null;
    }

    for (const fn of this.cleanupCallbacks) {
      try {
        fn();
      } catch {}
    }
    this.cleanupCallbacks = [];
    this.abortReject = null;
  }

  installSessionListeners(): void {
    const onFrameNavigated = (evt: Protocol.Page.FrameNavigatedEvent) => {
      if (!evt?.frame?.id) return;

      const mainFrameId = this.page.mainFrameId();
      if (evt.frame.id !== mainFrameId) return;

      const loaderId = evt.frame.loaderId;
      if (!loaderId) return;
      if (this.isSuperseded()) {
        this.triggerAbort(new Error("Navigation was superseded by a new request"));
        return;
      }
      this.resolveNavigationStart(false);

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

    const onNavigatedWithinDocument = (evt: Protocol.Page.NavigatedWithinDocumentEvent) => {
      if (evt?.frameId !== this.page.mainFrameId()) return;
      if (this.isSuperseded()) {
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

  async awaitNavigationStart(deadline: number): Promise<boolean> {
    if (this.abortError) throw this.abortError;
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

  async waitForMainLoadState(state: LoadState, deadline: number): Promise<void> {
    if (this.abortError) throw this.abortError;
    try {
      await this.awaitWithAbort(
        this.page.waitForMainLoadState(state, this.timeRemaining(deadline)),
      );
    } catch (error) {
      if (error instanceof TimeoutError && !this.abortError) {
        throw new TimeoutError(state, this.timeout);
      }
      throw error;
    }
  }

  timeRemaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new TimeoutError("Lifecycle wait", this.timeout);
    }
    return remaining;
  }

  async awaitWithAbort<T>(operation: Promise<T>): Promise<T> {
    try {
      return await Promise.race([operation, this.abortPromise]);
    } catch (error) {
      if (this.abortError) throw this.abortError;
      throw error;
    }
  }

  isSuperseded(): boolean {
    return (
      this.navigationCommandId !== undefined &&
      !this.page.isCurrentNavigationCommand(this.navigationCommandId)
    );
  }

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

      // Loaderless requests, such as Web Worker scripts, never finish on the page session.
      if (loaderId) {
        return info.loaderId === loaderId;
      }

      if (!info.loaderId && info.frameId) {
        return info.frameId === mainFrameId;
      }

      return true;
    };
  }
}
