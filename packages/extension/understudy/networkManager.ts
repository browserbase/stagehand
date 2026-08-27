import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import {
  DEFAULT_IDLE_WAIT,
  IGNORED_RESOURCE_TYPES,
  NetworkCaptureEvent,
  NetworkCaptureObserver,
  NetworkObserver,
  NetworkRequestInfo,
  WaitForIdleHandle,
  WaitForIdleOptions,
} from "../types/private/network.js";

const NETWORK_CAPTURE_BUFFER_LIMITS = {
  maxResourceBufferSize: 5_000_000,
  maxTotalBufferSize: 10_000_000,
} as const;

type NetworkCaptureRequest = {
  requestKey: string;
  requestId: string;
  startedAt: number;
};

type NetworkCaptureResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
};

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
  readonly sessions = new Map<
    string,
    {
      session: CDPSessionLike;
      detach: () => void;
    }
  >();

  readonly observers = new Set<NetworkObserver>();

  readonly captureObservers = new Set<NetworkCaptureObserver>();

  readonly captureRequests = new Map<string, NetworkCaptureRequest>();

  readonly captureResponses = new Map<string, NetworkCaptureResponse>();

  readonly requests = new Map<string, NetworkRequestInfo>();

  readonly documentRequestsByFrame = new Map<string, string>();

  /**
   * Begin tracking network traffic for a CDP session (top-level or OOPIF).
   * Safe to call multiple times; duplicate registrations are ignored.
   */
  public trackSession(session: CDPSessionLike): void {
    const sid = this.sessionKey(session);
    if (this.sessions.has(sid)) return;

    const onRequest = (evt: Protocol.Network.RequestWillBeSentEvent) => {
      if (!evt || !evt.requestId) return;

      const info: NetworkRequestInfo = {
        sessionId: sid,
        requestId: evt.requestId,
        requestKey: this.requestKey(sid, evt.requestId),
        frameId: evt.frameId ?? undefined,
        loaderId: evt.loaderId ?? undefined,
        url: evt.request?.url,
        timestamp: Date.now(),
        resourceType: evt.type,
        documentRequest: evt.type === "Document",
      };

      this.requests.set(info.requestKey, info);
      if (info.documentRequest && info.frameId) {
        this.documentRequestsByFrame.set(info.frameId, info.requestKey);
      }

      this.emitStart(info);

      if (this.captureObservers.size > 0) {
        if (evt.redirectResponse) {
          this.emitRedirectCapture(sid, info.requestKey, evt.requestId, evt.redirectResponse);
        }
        this.captureRequests.set(info.requestKey, {
          requestKey: info.requestKey,
          requestId: evt.requestId,
          startedAt: Date.now(),
        });
        this.emitCapture({
          method: "Network.requestWillBeSent",
          params: {
            requestKey: info.requestKey,
            requestId: evt.requestId,
            url: evt.request.url,
            httpMethod: evt.request.method,
            headers: normalizeHeaders(evt.request.headers),
            body: evt.request.postData ?? null,
            resourceType: evt.type ?? "Other",
            timestamp: new Date().toISOString(),
          },
          sessionId: sid,
        });
      }
    };

    const finish = (reqId: string) => {
      const key = this.requestKey(sid, reqId);
      const stored = this.requests.get(key);
      if (stored?.frameId) {
        this.documentRequestsByFrame.delete(stored.frameId);
      }
      const info: NetworkRequestInfo = stored ?? {
        sessionId: sid,
        requestId: reqId,
        requestKey: key,
        timestamp: Date.now(),
        documentRequest: false,
      };
      this.requests.delete(key);
      this.emitFinish(info);
    };

    const fail = (reqId: string) => {
      const key = this.requestKey(sid, reqId);
      const stored = this.requests.get(key);
      if (stored?.frameId) {
        this.documentRequestsByFrame.delete(stored.frameId);
      }
      const info: NetworkRequestInfo = stored ?? {
        sessionId: sid,
        requestId: reqId,
        requestKey: key,
        timestamp: Date.now(),
        documentRequest: false,
      };
      this.requests.delete(key);
      this.emitFailure(info);
    };

    const onFinished = (evt: { requestId: string }) => {
      if (!evt?.requestId) return;
      finish(evt.requestId);
      if (this.captureObservers.size > 0) {
        void this.emitFinishedCapture(session, sid, evt.requestId);
      }
    };

    const onFailed = (evt: Protocol.Network.LoadingFailedEvent) => {
      if (!evt?.requestId) return;
      fail(evt.requestId);
      if (this.captureObservers.size > 0) {
        this.emitFailedCapture(sid, evt);
      }
    };

    const onResponse = (evt: Protocol.Network.ResponseReceivedEvent) => {
      if (!evt?.requestId) return;
      if (this.captureObservers.size > 0 && evt.response) {
        this.captureResponses.set(this.requestKey(sid, evt.requestId), {
          status: evt.response.status,
          statusText: evt.response.statusText,
          headers: normalizeHeaders(evt.response.headers),
          mimeType: evt.response.mimeType,
        });
      }
      const url = evt.response?.url ?? "";
      if (url.startsWith("data:")) finish(evt.requestId);
    };

    const onFrameStopped = (evt: Protocol.Page.FrameStoppedLoadingEvent) => {
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
      this.emitFinish({ ...stored, timestamp: Date.now() });
    };

    session.on("Network.requestWillBeSent", onRequest);
    session.on("Network.loadingFinished", onFinished);
    session.on("Network.loadingFailed", onFailed);
    session.on("Network.requestServedFromCache", onFinished);
    session.on("Network.responseReceived", onResponse);
    session.on("Page.frameStoppedLoading", onFrameStopped);

    void session
      .send(
        "Network.enable",
        this.captureObservers.size > 0 ? NETWORK_CAPTURE_BUFFER_LIMITS : undefined,
      )
      .catch(() => {});
    void session.send("Page.enable").catch(() => {});

    this.sessions.set(sid, {
      session,
      detach: () => {
        session.off("Network.requestWillBeSent", onRequest);
        session.off("Network.loadingFinished", onFinished);
        session.off("Network.loadingFailed", onFailed);
        session.off("Network.requestServedFromCache", onFinished);
        session.off("Network.responseReceived", onResponse);
        session.off("Page.frameStoppedLoading", onFrameStopped);
      },
    });
  }

  /**
   * Stop tracking a session and discard any inflight bookkeeping owned by it.
   */
  public untrackSession(rawSessionId: string | undefined): void {
    const sid = rawSessionId ?? "__main__";
    const entry = this.sessions.get(sid);
    if (!entry) return;
    entry.detach();
    this.sessions.delete(sid);

    for (const key of this.requests.keys()) {
      if (key.startsWith(`${sid}:`)) this.requests.delete(key);
    }
    for (const key of this.captureRequests.keys()) {
      if (key.startsWith(`${sid}:`)) this.captureRequests.delete(key);
    }
    for (const key of this.captureResponses.keys()) {
      if (key.startsWith(`${sid}:`)) this.captureResponses.delete(key);
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
   * Register an observer for typed request/response capture records.
   * Network tracking remains enabled after disposal because navigation and idle
   * detection share the same CDP domain.
   */
  public addCaptureObserver(observer: NetworkCaptureObserver): () => void {
    const firstObserver = this.captureObservers.size === 0;
    this.captureObservers.add(observer);
    if (firstObserver) {
      for (const { session } of this.sessions.values()) {
        void session.send("Network.enable", NETWORK_CAPTURE_BUFFER_LIMITS).catch(() => undefined);
      }
    }
    return () => {
      this.captureObservers.delete(observer);
      if (this.captureObservers.size === 0) {
        this.captureRequests.clear();
        this.captureResponses.clear();
      }
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
    this.sessions.clear();
    this.observers.clear();
    this.captureObservers.clear();
    this.requests.clear();
    this.captureRequests.clear();
    this.captureResponses.clear();
    this.documentRequestsByFrame.clear();
  }

  /** Fan-out helper when a tracked request starts. */
  emitStart(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestStarted(info);
    }
  }

  /** Fan-out helper when a tracked request completes successfully. */
  emitFinish(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFinished(info);
    }
  }

  /** Fan-out helper when a tracked request fails mid-flight. */
  emitFailure(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFailed(info);
    }
  }

  private emitCapture(event: NetworkCaptureEvent): void {
    for (const observer of this.captureObservers) {
      try {
        observer(event);
      } catch {
        // Capture observers are passive and must not disrupt CDP dispatch.
      }
    }
  }

  private emitRedirectCapture(
    sessionId: string,
    requestKey: string,
    requestId: string,
    response: Protocol.Network.Response,
  ): void {
    const request = this.captureRequests.get(requestKey);
    this.emitCapture({
      method: "Network.loadingFinished",
      params: {
        requestKey,
        requestId,
        status: response.status,
        statusText: response.statusText,
        headers: normalizeHeaders(response.headers),
        mimeType: response.mimeType,
        body: null,
        base64Encoded: false,
        durationMs: request ? Date.now() - request.startedAt : 0,
      },
      sessionId,
    });
    this.captureRequests.delete(requestKey);
    this.captureResponses.delete(requestKey);
  }

  private async emitFinishedCapture(
    session: CDPSessionLike,
    sessionId: string,
    requestId: string,
  ): Promise<void> {
    const requestKey = this.requestKey(sessionId, requestId);
    const request = this.captureRequests.get(requestKey);
    const response = this.captureResponses.get(requestKey);
    let body: string | null = null;
    let base64Encoded = false;
    try {
      const result = await session.send<{ body?: string; base64Encoded?: boolean }>(
        "Network.getResponseBody",
        { requestId },
      );
      body = result.body ?? null;
      base64Encoded = result.base64Encoded ?? false;
    } catch {
      // Some response types do not expose a body through CDP.
    }

    this.emitCapture({
      method: "Network.loadingFinished",
      params: {
        requestKey,
        requestId,
        status: response?.status ?? 0,
        statusText: response?.statusText ?? "",
        headers: response?.headers ?? {},
        mimeType: response?.mimeType ?? "",
        body,
        base64Encoded,
        durationMs: request ? Date.now() - request.startedAt : 0,
      },
      sessionId,
    });
    if (this.captureRequests.get(requestKey) === request) {
      this.captureRequests.delete(requestKey);
      this.captureResponses.delete(requestKey);
    }
  }

  private emitFailedCapture(sessionId: string, event: Protocol.Network.LoadingFailedEvent): void {
    const requestKey = this.requestKey(sessionId, event.requestId);
    const request = this.captureRequests.get(requestKey);
    this.emitCapture({
      method: "Network.loadingFailed",
      params: {
        requestKey,
        requestId: event.requestId,
        errorText: event.errorText,
        durationMs: request ? Date.now() - request.startedAt : 0,
      },
      sessionId,
    });
    this.captureRequests.delete(requestKey);
    this.captureResponses.delete(requestKey);
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

function normalizeHeaders(headers: Protocol.Network.Headers | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name, String(value)]),
  );
}
