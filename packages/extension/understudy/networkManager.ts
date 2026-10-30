import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { SessionNetworkCapture } from "./sessionNetworkCapture.js";
import type { Page } from "./page.js";
import { Response } from "./response.js";
import {
  DEFAULT_IDLE_WAIT,
  IGNORED_RESOURCE_TYPES,
  NetworkObserver,
  NetworkRequestInfo,
  WaitForIdleHandle,
  WaitForIdleOptions,
} from "../types/private/network.js";

/**
 * Cross-session network tracker.
 *
 * Centralises network bookkeeping for a Page: every CDP session (top-level and OOPIF)
 * funnels `Network.*` events through here so higher-level waiters can reason about
 * in-flight requests across the entire frame tree. The manager exposes a simple
 * observer interface plus a "wait until idle" helper that resolves once no filtered
 * requests remain for a quiet window.
 */

/**
 * Aggregates network information for all CDP sessions owned by a Page.
 */
export class NetworkManager {
  private readonly pendingResponses = new Set<Response>();

  constructor(private readonly page: Page) {}

  readonly sessions = new Map<
    string,
    {
      session: CDPSessionLike;
      capture: SessionNetworkCapture;
      detach: () => void;
    }
  >();

  readonly observers = new Set<NetworkObserver>();

  readonly requests = new Map<string, NetworkRequestInfo>();

  readonly documentRequestsByFrame = new Map<string, string>();

  /**
   * Begin tracking network traffic for a CDP session (top-level or OOPIF).
   * A supplied capture transfers ownership here; its domains must already be enabled.
   * Safe to call multiple times with the same session/capture.
   */
  public trackSession(session: CDPSessionLike, pendingCapture?: SessionNetworkCapture): void {
    if (pendingCapture && pendingCapture.session !== session) {
      throw new Error("Network capture belongs to a different session");
    }
    const sid = this.sessionKey(session);
    const existing = this.sessions.get(sid);
    if (existing) {
      if (pendingCapture && existing.capture !== pendingCapture) {
        throw new Error("Network session already has a different capture");
      }
      return;
    }

    const onRequest = (evt: Protocol.Network.RequestWillBeSentEvent, receivedAt: number) => {
      if (!evt || !evt.requestId) return;

      const info: NetworkRequestInfo = {
        sessionId: sid,
        requestId: evt.requestId,
        requestKey: this.requestKey(sid, evt.requestId),
        frameId: evt.frameId ?? undefined,
        loaderId: evt.loaderId ?? undefined,
        url: evt.request?.url,
        timestamp: receivedAt,
        resourceType: evt.type,
        documentRequest: evt.type === "Document",
      };

      this.requests.set(info.requestKey, info);
      if (info.documentRequest && info.frameId) {
        this.documentRequestsByFrame.set(info.frameId, info.requestKey);
      }

      this.emitStart(info);
    };

    const finish = (reqId: string, receivedAt: number) => {
      const key = this.requestKey(sid, reqId);
      const stored = this.requests.get(key);
      if (stored?.frameId) {
        this.documentRequestsByFrame.delete(stored.frameId);
      }
      const info: NetworkRequestInfo = stored ?? {
        sessionId: sid,
        requestId: reqId,
        requestKey: key,
        timestamp: receivedAt,
        documentRequest: false,
      };
      this.requests.delete(key);
      this.emitFinish(info);
    };

    const fail = (reqId: string, receivedAt: number) => {
      const key = this.requestKey(sid, reqId);
      const stored = this.requests.get(key);
      if (stored?.frameId) {
        this.documentRequestsByFrame.delete(stored.frameId);
      }
      const info: NetworkRequestInfo = stored ?? {
        sessionId: sid,
        requestId: reqId,
        requestKey: key,
        timestamp: receivedAt,
        documentRequest: false,
      };
      this.requests.delete(key);
      this.emitFailure(info);
    };

    const onFinished = (evt: { requestId: string }, receivedAt: number) => {
      if (!evt?.requestId) return;
      finish(evt.requestId, receivedAt);
    };

    const onFailed = (evt: Protocol.Network.LoadingFailedEvent, receivedAt: number) => {
      if (!evt?.requestId) return;
      this.finishResponse(
        session,
        evt.requestId,
        new Error(evt.errorText || "Navigation request failed"),
      );
      fail(evt.requestId, receivedAt);
    };

    const onResponse = (evt: Protocol.Network.ResponseReceivedEvent, receivedAt: number) => {
      if (!evt?.requestId) return;
      this.emitResponse(evt, session);
      const url = evt.response?.url ?? "";
      if (url.startsWith("data:")) finish(evt.requestId, receivedAt);
    };

    const onFrameStopped = (evt: Protocol.Page.FrameStoppedLoadingEvent, receivedAt: number) => {
      if (!evt?.frameId) return;
      const key = this.documentRequestsByFrame.get(evt.frameId);
      if (!key) return;
      const stored = this.requests.get(key);
      if (!stored) {
        this.documentRequestsByFrame.delete(evt.frameId);
        return;
      }
      this.requests.delete(key);
      this.documentRequestsByFrame.delete(evt.frameId);
      this.emitFinish({ ...stored, timestamp: receivedAt });
    };

    const capture = pendingCapture ?? new SessionNetworkCapture(session);
    // Register ownership before replay: observers may untrack or dispose during delivery.
    this.sessions.set(sid, { session, capture, detach: () => capture.dispose() });
    try {
      capture.attach({
        "Network.requestWillBeSent": onRequest,
        "Network.loadingFinished": (event, receivedAt) => {
          this.finishResponse(session, event.requestId, null);
          onFinished(event, receivedAt);
        },
        "Network.loadingFailed": onFailed,
        "Network.requestServedFromCache": onFinished,
        "Network.responseReceived": onResponse,
        "Page.frameStoppedLoading": onFrameStopped,
      });
    } catch (error) {
      this.untrackSession(sid);
      throw error;
    }

    if (!pendingCapture) {
      void session.send("Network.enable").catch(() => {});
      void session.send("Page.enable").catch(() => {});
    }
  }

  /**
   * Stop tracking a session and discard any inflight bookkeeping owned by it.
   */
  public untrackSession(rawSessionId: string | undefined): void {
    const sid = rawSessionId ?? "__main__";
    const entry = this.sessions.get(sid);
    if (!entry) return;
    entry.detach();
    this.disposeResponsesForSession(entry.session);
    this.sessions.delete(sid);

    for (const key of this.requests.keys()) {
      if (key.startsWith(`${sid}:`)) this.requests.delete(key);
    }

    for (const [frameId, key] of this.documentRequestsByFrame.entries()) {
      if (key.startsWith(`${sid}:`)) {
        this.documentRequestsByFrame.delete(frameId);
      }
    }
  }

  /**
   * Register a passive observer for request lifecycle notifications.
   * Returns a disposer that removes the observer.
   */
  public addObserver(observer: NetworkObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Resolve once no (filtered) requests are in flight for the given quiet window.
   * The waiter automatically unregisters itself on completion or timeout.
   */
  public waitForIdle(options: WaitForIdleOptions): WaitForIdleHandle {
    const startTime = options.startTime ?? Date.now();
    const idleTimeMs = options.idleTimeMs ?? DEFAULT_IDLE_WAIT;
    const timeout = options.timeout;
    const remainingBudgetMs = Number.isFinite(timeout) ? timeout : undefined;
    const originalBudgetMs = Number.isFinite(options.totalBudgetMs ?? NaN)
      ? (options.totalBudgetMs as number)
      : remainingBudgetMs;

    const filter =
      options.filter ??
      ((info: NetworkRequestInfo) => {
        return !IGNORED_RESOURCE_TYPES.has(info.resourceType);
      });

    const tracked = new Set<string>();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    let resolveFn: (() => void) | null = null;
    let rejectFn: ((error: Error) => void) | null = null;

    const cleanup = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      removeObserver();
      tracked.clear();
      if (error) {
        rejectFn?.(error);
      } else {
        resolveFn?.();
      }
    };

    const maybeIdle = () => {
      if (settled) return;
      if (tracked.size === 0) {
        if (!idleTimer) {
          idleTimer = setTimeout(() => {
            cleanup();
          }, idleTimeMs);
        }
      } else if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const observer: NetworkObserver = {
      onRequestStarted: (info) => {
        if (settled) return;
        if (info.timestamp < startTime) return;
        if (!filter(info)) return;
        tracked.add(info.requestKey);
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      },
      onRequestFinished: (info) => {
        if (settled) return;
        if (!tracked.delete(info.requestKey)) return;
        maybeIdle();
      },
      onRequestFailed: (info) => {
        if (settled) return;
        if (!tracked.delete(info.requestKey)) return;
        maybeIdle();
      },
    };

    const removeObserver = this.addObserver(observer);

    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    // Trigger initial idle check so that we still respect the quiet window
    maybeIdle();

    if (Number.isFinite(timeout)) {
      timeoutTimer = setTimeout(
        () => {
          const elapsed = Date.now() - startTime;
          const message =
            originalBudgetMs !== undefined
              ? `networkidle timed out after ${originalBudgetMs}ms`
              : `networkidle timed out after ${elapsed}ms`;
          cleanup(new Error(message));
        },
        Math.max(0, timeout),
      );
    }

    return {
      promise,
      dispose: () => cleanup(new Error("waitForIdle disposed")),
    };
  }

  /**
   * Tear down all session listeners and clear observers/bookkeeping.
   */
  public dispose(): void {
    for (const { detach } of this.sessions.values()) {
      detach();
    }
    for (const response of this.pendingResponses) response.dispose();
    this.pendingResponses.clear();
    this.sessions.clear();
    this.observers.clear();
    this.requests.clear();
    this.documentRequestsByFrame.clear();
  }

  public subscribeResponse(listener: (response: Response) => void): () => void {
    return this.addObserver({ onResponse: listener });
  }

  /** Materialize one response for all interested observers; body retrieval stays lazy. */
  private emitResponse(
    event: Protocol.Network.ResponseReceivedEvent,
    session: CDPSessionLike,
  ): void {
    if (![...this.observers].some((observer) => typeof observer.onResponse === "function")) return;
    const response = new Response({
      page: this.page,
      session,
      requestId: event.requestId,
      frameId: event.frameId,
      loaderId: event.loaderId,
      response: event.response,
      fromServiceWorker: Boolean(event.response.fromServiceWorker),
    });
    this.pendingResponses.add(response);
    void response.finished().then(() => this.pendingResponses.delete(response));
    for (const observer of this.observers) {
      observer.onResponse?.(response);
    }
  }

  // A response created during replay cannot receive completion through its raw
  // session listeners if that event arrived before adoption. Deliver it here too.
  private finishResponse(session: CDPSessionLike, requestId: string, error: Error | null): void {
    for (const response of this.pendingResponses) {
      if (response.session === session && response.requestId === requestId) {
        response.markFinished(error);
      }
    }
  }

  private disposeResponsesForSession(session: CDPSessionLike): void {
    for (const response of this.pendingResponses) {
      if (response.session !== session) continue;
      response.dispose(new Error("Response session was detached"));
      this.pendingResponses.delete(response);
    }
  }

  /** Fan-out helper when a tracked request starts. */
  emitStart(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestStarted?.(info);
    }
  }

  /** Fan-out helper when a tracked request completes successfully. */
  emitFinish(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFinished?.(info);
    }
  }

  /** Fan-out helper when a tracked request fails mid-flight. */
  emitFailure(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFailed?.(info);
    }
  }

  /** Compute a stable key for a session (falls back to synthetic root id). */
  sessionKey(session: CDPSessionLike): string {
    return session.id ?? "__main__";
  }

  /** Compose the unique key for tracking a request under a session. */
  requestKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}
