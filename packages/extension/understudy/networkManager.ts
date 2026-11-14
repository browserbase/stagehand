import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { SessionNetworkCapture } from "./sessionNetworkCapture.js";
import type { Page } from "./page.js";
import { Response } from "./response.js";
import {
  DEFAULT_IDLE_WAIT,
  IGNORED_RESOURCE_TYPES,
  type DocumentIdentity,
  type PendingDocumentCompletion,
  type TrackedSession,
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
  private readonly pendingResponses = new Map<Response, Protocol.Network.ResourceType>();

  // Captures from nested targets can replay before their parents' headers.
  // Retain only completions without a local request, scoped to the child root.
  private readonly pendingDocumentCompletions = new Map<string, PendingDocumentCompletion>();

  constructor(private readonly page: Page) {}

  readonly sessions = new Map<string, TrackedSession>();

  readonly observers = new Set<NetworkObserver>();

  readonly requests = new Map<string, NetworkRequestInfo>();

  readonly documentRequestsByFrame = new Map<string, string>();

  /**
   * Begin tracking network traffic for a CDP session (top-level or OOPIF).
   * A supplied capture transfers ownership here; its domains must already be enabled.
   * The child root identifies document requests that can finish on this session after a process swap.
   * Safe to call multiple times with the same session/capture.
   */
  public trackSession(
    session: CDPSessionLike,
    pendingCapture?: SessionNetworkCapture,
    childMainFrameId?: string,
  ): void {
    if (pendingCapture && pendingCapture.session !== session) {
      throw new Error("Network capture belongs to a different session");
    }
    const sid = this.sessionKey(session);
    const existing = this.sessions.get(sid);
    if (existing) {
      if (pendingCapture && existing.capture !== pendingCapture) {
        throw new Error("Network session already has a different capture");
      }
      if (childMainFrameId) existing.childMainFrameId = childMainFrameId;
      return;
    }

    const unfinishedRequests = new Map<string, NetworkRequestInfo>();
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

      unfinishedRequests.set(evt.requestId, info);
      this.requests.set(info.requestKey, info);
      if (info.documentRequest && info.frameId) {
        this.documentRequestsByFrame.set(info.frameId, info.requestKey);
      }

      this.emitStart(info);
      const completion = info.documentRequest ? this.findDocumentCompletion(info) : undefined;
      if (completion) {
        unfinishedRequests.delete(info.requestId);
        this.takeIdleRequest(session, info.requestId, receivedAt);
        if (completion.error) this.emitFailure(info);
        else this.emitFinish(info);
      }
    };

    const completeRequest = (requestId: string, receivedAt: number, error: Error | null) => {
      this.finishResponse(session, requestId, error);
      unfinishedRequests.delete(requestId);
      const info = this.takeIdleRequest(session, requestId, receivedAt);
      this.sessions.get(info.sessionId)?.unfinishedRequests.delete(requestId);
      if (error) this.emitFailure(info);
      else this.emitFinish(info);
    };

    const onResponse = (evt: Protocol.Network.ResponseReceivedEvent, receivedAt: number) => {
      if (!evt?.requestId) return;
      this.emitResponse(evt, session);
      const url = evt.response?.url ?? "";
      if (url.startsWith("data:")) {
        unfinishedRequests.delete(evt.requestId);
        this.emitFinish(this.takeIdleRequest(session, evt.requestId, receivedAt));
      }
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
      this.removeIdleRequest(stored);
      this.emitFinish({ ...stored, timestamp: receivedAt });
    };

    const capture = pendingCapture ?? new SessionNetworkCapture(session);
    // Register ownership before replay: observers may untrack or dispose during delivery.
    this.sessions.set(sid, {
      session,
      capture,
      childMainFrameId,
      unfinishedRequests,
      detach: () => capture.dispose(),
    });
    try {
      capture.attach({
        "Network.requestWillBeSent": onRequest,
        "Network.loadingFinished": (event, receivedAt) => {
          if (event?.requestId) completeRequest(event.requestId, receivedAt, null);
        },
        "Network.loadingFailed": (event, receivedAt) => {
          if (!event?.requestId) return;
          const error = new Error(event.errorText || "Navigation request failed");
          completeRequest(event.requestId, receivedAt, error);
        },
        "Network.requestServedFromCache": (event, receivedAt) => {
          if (event?.requestId) {
            this.emitFinish(this.takeIdleRequest(session, event.requestId, receivedAt));
          }
        },
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
    this.disposeResponsesForSession(entry.session, entry.childMainFrameId);
    this.sessions.delete(sid);
    for (const [key, completion] of this.pendingDocumentCompletions) {
      if (completion.session === entry.session) this.pendingDocumentCompletions.delete(key);
    }

    for (const info of this.requests.values()) {
      if (
        info.sessionId !== sid &&
        !(entry.childMainFrameId && info.documentRequest && info.frameId === entry.childMainFrameId)
      )
        continue;
      this.removeIdleRequest(info);
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
    for (const response of this.pendingResponses.keys()) response.dispose();
    this.pendingResponses.clear();
    this.pendingDocumentCompletions.clear();
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
    const completion = event.type === "Document" ? this.findDocumentCompletion(event) : undefined;
    if (completion) {
      this.pendingDocumentCompletions.delete(
        this.requestKey(this.sessionKey(completion.session), event.requestId),
      );
    }
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
    this.pendingResponses.set(response, event.type);
    void response.finished().then(() => this.pendingResponses.delete(response));
    if (completion) {
      response.updateSession(completion.session);
      response.markFinished(completion.error);
    }
    for (const observer of this.observers) {
      observer.onResponse?.(response);
    }
  }

  /** Retire idle bookkeeping, preserving the original key across a session handoff. */
  private takeIdleRequest(
    session: CDPSessionLike,
    requestId: string,
    receivedAt: number,
  ): NetworkRequestInfo {
    const sid = this.sessionKey(session);
    let info = this.requests.get(this.requestKey(sid, requestId));
    if (!info) {
      const frameId = this.sessions.get(sid)?.childMainFrameId;
      const key = frameId ? this.documentRequestsByFrame.get(frameId) : undefined;
      const document = key ? this.requests.get(key) : undefined;
      if (
        document?.documentRequest &&
        document.requestId === requestId &&
        document.loaderId === requestId
      ) {
        info = document;
      }
    }
    if (info) {
      this.removeIdleRequest(info);
      return info;
    }
    return {
      sessionId: sid,
      requestId,
      requestKey: this.requestKey(sid, requestId),
      timestamp: receivedAt,
      documentRequest: false,
    };
  }

  private removeIdleRequest(info: NetworkRequestInfo): void {
    this.requests.delete(info.requestKey);
    if (info.frameId && this.documentRequestsByFrame.get(info.frameId) === info.requestKey) {
      this.documentRequestsByFrame.delete(info.frameId);
    }
  }

  // A document can receive headers on its parent session and finish in its new
  // iframe session, without another requestWillBeSent. Ordinary requests remain
  // session-scoped; only a document matching the child root and loader can move.
  private finishResponse(session: CDPSessionLike, requestId: string, error: Error | null): void {
    const pending = [...this.pendingResponses.keys()].filter(
      (response) => !response.finishedSettled && response.requestId === requestId,
    );
    const localResponses = pending.filter((response) => response.session === session);
    if (localResponses.length) {
      // Raw listeners cannot receive events that arrived before capture replay.
      for (const response of localResponses) response.markFinished(error);
      return;
    }

    const sid = this.sessionKey(session);
    const trackedSession = this.sessions.get(sid);
    // A local request without headers may have failed; do not claim another session's response.
    if (trackedSession?.unfinishedRequests.has(requestId)) return;
    const frameId = trackedSession?.childMainFrameId;
    if (!frameId) return;

    for (const entry of this.sessions.values()) {
      const info = entry.unfinishedRequests.get(requestId);
      if (info?.documentRequest && info.loaderId === requestId && info.frameId === frameId) {
        entry.unfinishedRequests.delete(requestId);
      }
    }
    const documents = pending.filter(
      (response) =>
        this.pendingResponses.get(response) === "Document" &&
        response.loaderId === requestId &&
        response.frameId === frameId,
    );
    const [document] = documents;
    if (documents.length === 1 && document) {
      document.updateSession(session);
      document.markFinished(error);
    } else if (!pending.length) {
      this.pendingDocumentCompletions.set(this.requestKey(sid, requestId), {
        session,
        frameId,
        requestId,
        error,
      });
    }
  }

  private findDocumentCompletion(request: DocumentIdentity): PendingDocumentCompletion | undefined {
    const { requestId, loaderId, frameId } = request;
    if (loaderId !== requestId || !frameId) return undefined;
    const matches = [...this.pendingDocumentCompletions.values()].filter(
      (completion) => completion.requestId === requestId && completion.frameId === frameId,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private disposeResponsesForSession(session: CDPSessionLike, childMainFrameId?: string): void {
    for (const [response, type] of this.pendingResponses) {
      // A child may detach before completion has transferred its document response.
      if (
        response.session !== session &&
        !(childMainFrameId && type === "Document" && response.frameId === childMainFrameId)
      )
        continue;
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
