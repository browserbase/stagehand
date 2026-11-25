import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { TimeoutError } from "../errors.js";
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

export class NetworkManager {
  private readonly pendingResponses = new Map<Response, Protocol.Network.ResourceType>();

  private readonly pendingDocumentCompletions = new Map<string, PendingDocumentCompletion>();
  private readonly activeIdleDisposers = new Set<() => void>();
  private readonly respondedRequestKeys = new Set<string>();
  private readonly completedRequestsBySession = new Map<string, Set<string>>();

  constructor(private readonly page: Page) {}

  readonly sessions = new Map<string, TrackedSession>();

  readonly observers = new Set<NetworkObserver>();

  readonly requests = new Map<string, NetworkRequestInfo>();

  readonly documentRequestsByFrame = new Map<string, string>();

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

      const requestKey = this.requestKey(sid, evt.requestId);
      const previous = this.requests.get(requestKey);
      if (previous) {
        this.removeIdleRequest(previous);
      }
      this.respondedRequestKeys.delete(requestKey);
      this.completedRequestsBySession.get(sid)?.delete(evt.requestId);

      const info: NetworkRequestInfo = {
        sessionId: sid,
        requestId: evt.requestId,
        requestKey,
        frameId: evt.frameId ?? undefined,
        loaderId: evt.loaderId ?? undefined,
        url: evt.request?.url,
        timestamp: receivedAt,
        resourceType: evt.type,
        documentRequest: evt.type === "Document",
      };

      const completion = info.documentRequest ? this.findDocumentCompletion(info) : undefined;
      if (completion?.requestRetired && evt.redirectResponse) {
        return;
      }

      if (info.documentRequest && info.frameId) {
        for (const [childSid, childEntry] of this.sessions) {
          if (childEntry.childMainFrameId === info.frameId) {
            this.completedRequestsBySession.get(childSid)?.delete(info.requestId);
          }
        }
        for (const [key, pendingCompletion] of this.pendingDocumentCompletions) {
          if (
            pendingCompletion.frameId === info.frameId &&
            pendingCompletion.requestId !== info.requestId &&
            pendingCompletion.requestRetired
          ) {
            this.pendingDocumentCompletions.delete(key);
          }
        }
      }

      unfinishedRequests.set(evt.requestId, info);
      this.requests.set(info.requestKey, info);
      if (info.documentRequest && info.frameId) {
        this.documentRequestsByFrame.set(info.frameId, info.requestKey);
      }

      this.emitStart(info);
      if (completion) {
        completion.requestRetired = true;
        unfinishedRequests.delete(info.requestId);
        const retired = this.takeIdleRequest(session, info.requestId);
        if (retired) {
          if (completion.error) this.emitFailure(retired);
          else this.emitFinish(retired);
        }
      }
    };

    const completeRequest = (requestId: string, error: Error | null) => {
      const hadLocalResponse = [...this.pendingResponses.keys()].some(
        (response) =>
          !response.finishedSettled &&
          response.session === session &&
          response.requestId === requestId,
      );
      this.finishResponse(session, requestId, error);
      if (!hadLocalResponse) {
        for (const [key, pendingCompletion] of this.pendingDocumentCompletions) {
          if (pendingCompletion.requestId === requestId && pendingCompletion.session !== session) {
            this.pendingDocumentCompletions.delete(key);
          }
        }
      }
      unfinishedRequests.delete(requestId);
      this.respondedRequestKeys.delete(this.requestKey(sid, requestId));
      this.recordCompletedRequest(sid, requestId);
      const info = this.takeIdleRequest(session, requestId);
      if (!info) return;
      this.sessions.get(info.sessionId)?.unfinishedRequests.delete(requestId);
      this.respondedRequestKeys.delete(info.requestKey);
      if (error) this.emitFailure(info);
      else this.emitFinish(info);
    };

    const onResponse = (evt: Protocol.Network.ResponseReceivedEvent) => {
      if (!evt?.requestId) return;
      const reqKey = this.requestKey(sid, evt.requestId);
      if (unfinishedRequests.has(evt.requestId)) {
        this.respondedRequestKeys.add(reqKey);
      }
      this.emitResponse(evt, session);
      const url = evt.response?.url ?? "";
      if (url.startsWith("data:")) {
        this.finishResponse(session, evt.requestId, null);
        unfinishedRequests.delete(evt.requestId);
        this.respondedRequestKeys.delete(reqKey);
        this.recordCompletedRequest(sid, evt.requestId);
        const info = this.takeIdleRequest(session, evt.requestId);
        if (info) this.emitFinish(info);
      }
    };

    const onFrameStopped = (evt: Protocol.Page.FrameStoppedLoadingEvent, receivedAt: number) => {
      if (!evt?.frameId) return;
      for (const [key, pendingCompletion] of this.pendingDocumentCompletions) {
        if (pendingCompletion.frameId === evt.frameId && pendingCompletion.requestRetired) {
          this.pendingDocumentCompletions.delete(key);
        }
      }
      const key = this.documentRequestsByFrame.get(evt.frameId);
      if (!key) return;
      const stored = this.requests.get(key);
      if (!stored) {
        this.documentRequestsByFrame.delete(evt.frameId);
        return;
      }
      this.sessions.get(stored.sessionId)?.unfinishedRequests.delete(stored.requestId);
      this.respondedRequestKeys.delete(stored.requestKey);
      this.recordCompletedRequest(stored.sessionId, stored.requestId);
      this.removeIdleRequest(stored);
      this.emitFinish({ ...stored, timestamp: receivedAt });
    };

    const onFrameNavigated = (evt: Protocol.Page.FrameNavigatedEvent) => {
      if (!evt?.frame) return;
      const { id, loaderId } = evt.frame;
      for (const [key, pendingCompletion] of this.pendingDocumentCompletions) {
        if (pendingCompletion.frameId === id && pendingCompletion.requestId !== loaderId) {
          this.pendingDocumentCompletions.delete(key);
        }
      }
      // Chrome sends no loadingFinished/loadingFailed for requests of the replaced document.
      for (const info of this.requests.values()) {
        if (info.frameId !== id || !info.loaderId || info.loaderId === loaderId) continue;
        const owner = this.sessions.get(info.sessionId);
        owner?.unfinishedRequests.delete(info.requestId);
        this.respondedRequestKeys.delete(info.requestKey);
        if (owner) this.failReplacedResponses(owner.session, info.requestId);
        this.removeIdleRequest(info);
        this.emitFailure(info);
      }
      for (const [ownerSid, owner] of this.sessions) {
        for (const [reqId, info] of owner.unfinishedRequests) {
          if (info.frameId !== id || !info.loaderId || info.loaderId === loaderId) continue;
          owner.unfinishedRequests.delete(reqId);
          this.respondedRequestKeys.delete(this.requestKey(ownerSid, reqId));
          this.failReplacedResponses(owner.session, reqId);
        }
      }
      for (const response of this.pendingResponses.keys()) {
        if (response.finishedSettled) continue;
        if (response.frameId !== id || !response.loaderId || response.loaderId === loaderId) {
          continue;
        }
        response.markFinished(new Error("Request was abandoned by a replaced document"));
        this.pendingResponses.delete(response);
      }
    };

    const capture = pendingCapture ?? new SessionNetworkCapture(session);
    this.completedRequestsBySession.set(sid, new Set());
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
        "Network.loadingFinished": (event) => {
          if (event?.requestId) completeRequest(event.requestId, null);
        },
        "Network.loadingFailed": (event) => {
          if (!event?.requestId) return;
          const error = new Error(event.errorText || "Navigation request failed");
          completeRequest(event.requestId, error);
        },
        "Network.requestServedFromCache": (event) => {
          if (!event?.requestId) return;
          const hadLocalUnfinished = unfinishedRequests.delete(event.requestId);
          this.respondedRequestKeys.delete(this.requestKey(sid, event.requestId));
          if (hadLocalUnfinished) {
            this.recordCompletedRequest(sid, event.requestId);
          }
          const info = this.takeIdleRequest(session, event.requestId);
          if (!info) return;
          if (info.sessionId !== sid) {
            this.sessions.get(info.sessionId)?.unfinishedRequests.delete(event.requestId);
            this.recordCompletedRequest(info.sessionId, event.requestId);
          }
          this.respondedRequestKeys.delete(info.requestKey);
          this.emitFinish(info);
        },
        "Network.responseReceived": onResponse,
        "Page.frameStoppedLoading": onFrameStopped,
        "Page.frameNavigated": onFrameNavigated,
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

  public untrackSession(rawSessionId: string | undefined): void {
    const sid = rawSessionId ?? "__main__";
    const entry = this.sessions.get(sid);
    if (!entry) return;
    entry.detach();
    this.disposeResponsesForSession(entry.session, entry.childMainFrameId);
    this.sessions.delete(sid);
    this.completedRequestsBySession.delete(sid);
    for (const reqId of entry.unfinishedRequests.keys()) {
      this.respondedRequestKeys.delete(this.requestKey(sid, reqId));
    }
    entry.unfinishedRequests.clear();
    for (const [key, completion] of this.pendingDocumentCompletions) {
      if (completion.session === entry.session) this.pendingDocumentCompletions.delete(key);
    }

    const removed: NetworkRequestInfo[] = [];
    for (const info of this.requests.values()) {
      if (
        info.sessionId !== sid &&
        !(entry.childMainFrameId && info.documentRequest && info.frameId === entry.childMainFrameId)
      )
        continue;
      if (info.sessionId !== sid) {
        this.sessions.get(info.sessionId)?.unfinishedRequests.delete(info.requestId);
      }
      this.respondedRequestKeys.delete(info.requestKey);
      this.removeIdleRequest(info);
      removed.push(info);
    }
    for (const info of removed) {
      this.emitFailure(info);
    }
  }

  public addObserver(observer: NetworkObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

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

    const disposeHandle = () => cleanup(new Error("waitForIdle disposed"));

    const cleanup = (error?: Error) => {
      if (settled) return;
      settled = true;
      this.activeIdleDisposers.delete(disposeHandle);
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
    this.activeIdleDisposers.add(disposeHandle);

    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    for (const info of this.requests.values()) {
      if (info.timestamp < startTime || !filter(info)) continue;
      tracked.add(info.requestKey);
    }

    maybeIdle();

    if (Number.isFinite(timeout)) {
      timeoutTimer = setTimeout(
        () => cleanup(new TimeoutError("networkidle", originalBudgetMs ?? Date.now() - startTime)),
        Math.max(0, timeout),
      );
    }

    return {
      promise,
      dispose: disposeHandle,
    };
  }

  public dispose(): void {
    for (const disposeIdle of this.activeIdleDisposers) {
      disposeIdle();
    }
    this.activeIdleDisposers.clear();
    for (const { detach } of this.sessions.values()) {
      detach();
    }
    for (const response of this.pendingResponses.keys()) response.dispose();
    this.pendingResponses.clear();
    this.pendingDocumentCompletions.clear();
    this.respondedRequestKeys.clear();
    this.completedRequestsBySession.clear();
    this.sessions.clear();
    this.observers.clear();
    this.requests.clear();
    this.documentRequestsByFrame.clear();
  }

  public subscribeResponse(listener: (response: Response) => void): () => void {
    return this.addObserver({ onResponse: listener });
  }

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
    if (completion) {
      response.updateSession(completion.session);
      response.markFinished(completion.error);
    } else {
      this.pendingResponses.set(response, event.type);
      void response.finished().then(() => this.pendingResponses.delete(response));
    }
    for (const observer of this.observers) {
      observer.onResponse?.(response);
    }
  }

  private takeIdleRequest(
    session: CDPSessionLike,
    requestId: string,
  ): NetworkRequestInfo | undefined {
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
    return undefined;
  }

  private failReplacedResponses(session: CDPSessionLike, requestId: string): void {
    for (const response of this.pendingResponses.keys()) {
      if (response.finishedSettled) continue;
      if (response.session !== session || response.requestId !== requestId) continue;
      response.markFinished(new Error("Request was abandoned by a replaced document"));
      this.pendingResponses.delete(response);
    }
  }

  private recordCompletedRequest(sid: string, requestId: string): void {
    const completed = this.completedRequestsBySession.get(sid);
    if (!completed) return;
    if (completed.size >= 1024) completed.clear();
    completed.add(requestId);
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
      for (const response of localResponses) {
        response.markFinished(error);
        this.pendingResponses.delete(response);
      }
      return;
    }

    const sid = this.sessionKey(session);
    const trackedSession = this.sessions.get(sid);
    if (trackedSession?.unfinishedRequests.has(requestId)) return;
    if (this.completedRequestsBySession.get(sid)?.has(requestId)) return;
    const frameId = trackedSession?.childMainFrameId;
    if (!frameId) return;

    let matchedParentResponded = false;
    let matchedParentDocument = false;
    for (const [entrySid, entry] of this.sessions) {
      const info = entry.unfinishedRequests.get(requestId);
      if (info?.documentRequest && info.loaderId === requestId && info.frameId === frameId) {
        entry.unfinishedRequests.delete(requestId);
        matchedParentDocument = true;
        if (this.respondedRequestKeys.delete(this.requestKey(entrySid, requestId))) {
          matchedParentResponded = true;
        }
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
      this.pendingResponses.delete(document);
    } else if (!pending.length && !matchedParentResponded) {
      this.recordPendingDocumentCompletion(this.requestKey(sid, requestId), {
        session,
        frameId,
        requestId,
        error,
        requestRetired: matchedParentDocument,
      });
    }
  }

  private recordPendingDocumentCompletion(
    key: string,
    completion: PendingDocumentCompletion,
  ): void {
    const MAX_PENDING_DOCUMENT_COMPLETIONS = 256;
    this.pendingDocumentCompletions.delete(key);
    while (this.pendingDocumentCompletions.size >= MAX_PENDING_DOCUMENT_COMPLETIONS) {
      let evictKey: string | undefined;
      for (const [candidateKey, candidate] of this.pendingDocumentCompletions) {
        if (candidate.requestRetired) {
          evictKey = candidateKey;
          break;
        }
      }
      evictKey ??= this.pendingDocumentCompletions.keys().next().value;
      if (!evictKey) break;
      this.pendingDocumentCompletions.delete(evictKey);
    }
    this.pendingDocumentCompletions.set(key, completion);
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
      if (
        response.session !== session &&
        !(childMainFrameId && type === "Document" && response.frameId === childMainFrameId)
      )
        continue;
      response.dispose(new Error("Response session was detached"));
      this.pendingResponses.delete(response);
    }
  }

  emitStart(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestStarted?.(info);
    }
  }

  emitFinish(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFinished?.(info);
    }
  }

  emitFailure(info: NetworkRequestInfo): void {
    for (const obs of this.observers) {
      obs.onRequestFailed?.(info);
    }
  }

  sessionKey(session: CDPSessionLike): string {
    return session.id ?? "__main__";
  }

  requestKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}
