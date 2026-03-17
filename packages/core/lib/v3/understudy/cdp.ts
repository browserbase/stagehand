// lib/v3/understudy/cdp.ts
import WebSocket from "ws";
import type { Protocol } from "devtools-protocol";
import { STAGEHAND_VERSION } from "../../version.js";
import {
  FlowLogger,
  type FlowEvent,
  type FlowLoggerContext,
} from "../flowlogger/FlowLogger.js";
import {
  CdpConnectionClosedError,
  PageNotFoundError,
} from "../types/public/sdkErrors.js";

/**
 * CDP transport & session multiplexer
 *
 * Owns the browser WebSocket and multiplexes flattened Target sessions.
 * Tracks inflight CDP calls, routes responses to the right session, and forwards events.
 *
 * This does not interpret Page/DOM/Runtime semantics — callers own that logic.
 */
export interface CDPSessionLike {
  send<R = unknown>(method: string, params?: object): Promise<R>;
  on<P = unknown>(event: string, handler: (params: P) => void): void;
  off<P = unknown>(event: string, handler: (params: P) => void): void;
  close(): Promise<void>;
  readonly id: string | null;
}

type Inflight = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  sessionId?: string | null;
  method: string;
  params?: object;
  stack?: string;
  ts: number;
  flowLoggerContext?: FlowLoggerContext | null; // Snapshot of the flow context captured when the request was sent; response handling re-enters this if ALS is gone.
  cdpCallEvent?: Pick<FlowEvent, "eventId" | "eventParentIds"> | null; // The emitted CdpCallEvent identity; later response/error events attach under this exact parent.
};

type EventHandler = (params: unknown) => void;
type SessionDispatchWaiter = {
  sessionId: string;
  method: string;
  match?: (params?: object) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

type RawMessage =
  | {
      id: number;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
      sessionId?: string;
    }
  | { method: string; params?: unknown; sessionId?: string };

export class CdpConnection implements CDPSessionLike {
  private ws: WebSocket;
  private nextId = 1;
  private inflight = new Map<number, Inflight>(); // Outstanding request records; `_sendViaSession()` inserts and `onMessage()` removes/resolves them.
  private latestCdpCallEvent = new Map<
    // Most recent CDP call per session/root; `_sendViaSession()` refreshes it and later unsolicited messages reuse it as their parent anchor.
    string | null,
    {
      flowLoggerContext: FlowLoggerContext; // Flow context captured when the latest call on this session/root was emitted.
      cdpCallEvent: Pick<FlowEvent, "eventId" | "eventParentIds">; // Identity of that latest call event; unsolicited messages reuse it as their parent.
    }
  >();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private sessions = new Map<string, CdpSession>();
  /** Maps sessionId -> targetId (1:1 mapping) */
  private sessionToTarget = new Map<string, string>();
  private sessionDispatchWaiters = new Set<SessionDispatchWaiter>();
  public readonly id: string | null = null; // root
  private transportCloseHandlers = new Set<(why: string) => void>();

  public flowLoggerContext?: FlowLoggerContext; // Instance-owned fallback flow context; V3 sets this once and later sends/callbacks re-enter it when ALS is absent.

  public onTransportClosed(handler: (why: string) => void): void {
    this.transportCloseHandlers.add(handler);
  }
  public offTransportClosed(handler: (why: string) => void): void {
    this.transportCloseHandlers.delete(handler);
  }

  private emitTransportClosed(why: string) {
    for (const h of this.transportCloseHandlers) {
      try {
        h(why);
      } catch {
        //
      }
    }
  }

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("close", (code, reason) => {
      // Reason is a Buffer in ws; stringify defensively
      const why = `socket-close code=${code} reason=${String(reason || "")}`;
      this.rejectAllInflight(why);
      this.emitTransportClosed(why);
    });

    this.ws.on("error", (err) => {
      const why = `socket-error ${err?.message ?? String(err)}`;
      this.rejectAllInflight(why);
      this.emitTransportClosed(why);
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
  }

  static async connect(
    wsUrl: string,
    options?: { headers?: Record<string, string> },
  ): Promise<CdpConnection> {
    // Include User-Agent header for server-side observability and version tracking
    // Merge user-provided headers, letting them override defaults
    const headers = {
      "User-Agent": `Stagehand/${STAGEHAND_VERSION}`,
      ...options?.headers,
    };
    const ws = new WebSocket(wsUrl, { headers });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(e));
    });
    return new CdpConnection(ws);
  }

  async enableAutoAttach(): Promise<void> {
    await this.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
  }

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const stack = new Error().stack?.split("\n").slice(1, 4).join("\n");
    const flowLoggerContext = FlowLogger.resolveContext(this.flowLoggerContext);
    const cdpCallEvent = flowLoggerContext
      ? FlowLogger.logCdpCallEvent(flowLoggerContext, {
          method,
          params,
          targetId: null,
        })
      : null;
    if (flowLoggerContext && cdpCallEvent) {
      this.latestCdpCallEvent.set(null, {
        flowLoggerContext,
        cdpCallEvent,
      });
    }
    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        sessionId: null,
        method,
        params,
        stack,
        ts: Date.now(),
        flowLoggerContext,
        cdpCallEvent,
      });
    });
    // Prevent unhandledRejection if a session detaches before the caller awaits.
    void p.catch(() => {});
    this.ws.send(JSON.stringify(payload));
    return p;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.eventHandlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event);
    if (set) set.delete(handler as EventHandler);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  private rejectAllInflight(why: string): void {
    for (const [id, entry] of this.inflight.entries()) {
      entry.reject(new CdpConnectionClosedError(why));
      this.inflight.delete(id);
    }
    this.latestCdpCallEvent.clear();
    for (const waiter of Array.from(this.sessionDispatchWaiters)) {
      waiter.reject(new CdpConnectionClosedError(why));
    }
  }

  getSession(sessionId: string): CdpSession | undefined {
    return this.sessions.get(sessionId);
  }

  waitForSessionDispatch(
    sessionId: string,
    method: string,
    match?: (params?: object) => boolean,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: SessionDispatchWaiter = {
        sessionId,
        method,
        match,
        resolve: () => {
          this.sessionDispatchWaiters.delete(waiter);
          resolve();
        },
        reject: (error: Error) => {
          this.sessionDispatchWaiters.delete(waiter);
          reject(error);
        },
      };
      this.sessionDispatchWaiters.add(waiter);
    });
  }

  async attachToTarget(targetId: string): Promise<CdpSession> {
    const { sessionId } = (await this.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    )) as { sessionId: string };

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new CdpSession(this, sessionId);
      this.sessions.set(sessionId, session);
    }
    this.sessionToTarget.set(sessionId, targetId);
    return session;
  }

  async getTargets(): Promise<Protocol.Target.TargetInfo[]> {
    const res = await this.send<{
      targetInfos: Protocol.Target.TargetInfo[];
    }>("Target.getTargets");
    return res.targetInfos;
  }

  private onMessage(json: string): void {
    const msg = JSON.parse(json) as RawMessage;

    if ("id" in msg) {
      const rec = this.inflight.get(msg.id);
      if (!rec) return;

      this.inflight.delete(msg.id);

      if ("error" in msg && msg.error) {
        // Response/error events only make sense if the original send captured
        // both a flow context to re-enter and the emitted CdpCallEvent to hang
        // the terminal edge under.
        if (rec.flowLoggerContext && rec.cdpCallEvent) {
          let targetId: string | null;
          if (rec.sessionId) {
            const mappedTargetId = this.sessionToTarget.get(rec.sessionId);
            if (mappedTargetId) {
              targetId = mappedTargetId;
            } else {
              targetId = rec.sessionId;
            }
          } else {
            targetId = null;
          }
          FlowLogger.logCdpResponseEvent(
            rec.flowLoggerContext,
            rec.cdpCallEvent,
            {
              method: rec.method,
              error: `${msg.error.code} ${msg.error.message}`,
              targetId,
            },
          );
        }
        rec.reject(new Error(`${msg.error.code} ${msg.error.message}`));
      } else {
        // Successful responses reuse the same cached call context so the
        // response lands under the exact CdpCallEvent emitted at send time.
        if (rec.flowLoggerContext && rec.cdpCallEvent) {
          let targetId: string | null;
          if (rec.sessionId) {
            const mappedTargetId = this.sessionToTarget.get(rec.sessionId);
            if (mappedTargetId) {
              targetId = mappedTargetId;
            } else {
              targetId = rec.sessionId;
            }
          } else {
            targetId = null;
          }
          FlowLogger.logCdpResponseEvent(
            rec.flowLoggerContext,
            rec.cdpCallEvent,
            {
              method: rec.method,
              result: (msg as { result?: unknown }).result,
              targetId,
            },
          );
        }
        rec.resolve((msg as { result?: unknown }).result);
      }
      return;
    }

    if ("method" in msg) {
      if (msg.method === "Target.attachedToTarget") {
        const p = (msg as { params: Protocol.Target.AttachedToTargetEvent })
          .params;
        if (!this.sessions.has(p.sessionId)) {
          this.sessions.set(p.sessionId, new CdpSession(this, p.sessionId));
        }
        this.sessionToTarget.set(p.sessionId, p.targetInfo.targetId);
      } else if (msg.method === "Target.detachedFromTarget") {
        const p = (msg as { params: Protocol.Target.DetachedFromTargetEvent })
          .params;
        for (const [id, entry] of this.inflight.entries()) {
          if (entry.sessionId === p.sessionId) {
            entry.reject(
              new PageNotFoundError(
                `target closed before CDP response (sessionId=${p.sessionId}, targetId=${p.targetId})`,
              ),
            );
            this.inflight.delete(id);
          }
        }
        for (const waiter of Array.from(this.sessionDispatchWaiters)) {
          if (waiter.sessionId === p.sessionId) {
            waiter.reject(
              new PageNotFoundError(
                `target closed before CDP send (sessionId=${p.sessionId}, targetId=${p.targetId})`,
              ),
            );
          }
        }
        this.sessions.delete(p.sessionId);
        this.sessionToTarget.delete(p.sessionId);
        this.latestCdpCallEvent.delete(p.sessionId);
      } else if (msg.method === "Target.targetDestroyed") {
        const p = (msg as { params: { targetId: string } }).params;
        // Remove any session mapping for this target
        for (const [sessionId, targetId] of this.sessionToTarget.entries()) {
          if (targetId === p.targetId) {
            this.sessionToTarget.delete(sessionId);
            this.latestCdpCallEvent.delete(sessionId);
            break;
          }
        }
      }

      const { method, params, sessionId } = msg;
      const latestCdpCallEvent =
        this.latestCdpCallEvent.get(sessionId ?? null) ??
        (sessionId ? this.latestCdpCallEvent.get(null) : null);
      let targetId: string | null;
      if (sessionId) {
        const mappedTargetId = this.sessionToTarget.get(sessionId);
        if (mappedTargetId) {
          targetId = mappedTargetId;
        } else {
          targetId = sessionId;
        }
      } else {
        targetId = null;
      }

      // Unsolicited protocol messages are attached under the most recent call on
      // that session/root when one is known, so later callbacks still show up
      // in the same flow subtree.
      if (latestCdpCallEvent) {
        FlowLogger.logCdpMessageEvent(
          latestCdpCallEvent.flowLoggerContext,
          latestCdpCallEvent.cdpCallEvent,
          {
            method,
            params,
            targetId,
          },
        );
      }

      const dispatch = () => {
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          session?.dispatch(method, params);

          // Forward target lifecycle events to root listeners as well.
          // Some browsers emit these via a parent session rather than the root
          // connection; fan-out keeps target tracking consistent.
          if (method.startsWith("Target.")) {
            const handlers = this.eventHandlers.get(method);
            if (handlers) for (const h of handlers) h(params);
          }
          return;
        }

        const handlers = this.eventHandlers.get(method);
        if (handlers) for (const h of handlers) h(params);
      };

      if (latestCdpCallEvent) {
        FlowLogger.withContext(latestCdpCallEvent.flowLoggerContext, dispatch);
      } else {
        dispatch();
      }
    }
  }

  _sendViaSession<R = unknown>(
    sessionId: string,
    method: string,
    params?: object,
  ): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params, sessionId };
    const stack = new Error().stack?.split("\n").slice(1, 4).join("\n");
    const flowLoggerContext = FlowLogger.resolveContext(this.flowLoggerContext);
    let targetId: string | null;
    const mappedTargetId = this.sessionToTarget.get(sessionId);
    if (mappedTargetId) {
      targetId = mappedTargetId;
    } else {
      targetId = null;
    }
    const cdpCallEvent = flowLoggerContext
      ? FlowLogger.logCdpCallEvent(flowLoggerContext, {
          method,
          params,
          targetId,
        })
      : null;
    if (flowLoggerContext && cdpCallEvent) {
      this.latestCdpCallEvent.set(sessionId, {
        flowLoggerContext,
        cdpCallEvent,
      });
    }

    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        sessionId,
        method,
        params,
        stack,
        ts: Date.now(),
        flowLoggerContext,
        cdpCallEvent,
      });
    });
    // Prevent unhandledRejection if a session detaches before the caller awaits.
    void p.catch(() => {});
    for (const waiter of Array.from(this.sessionDispatchWaiters)) {
      if (waiter.sessionId !== sessionId) continue;
      if (waiter.method !== method) continue;
      if (waiter.match && !waiter.match(params)) continue;
      waiter.resolve();
      break;
    }
    this.ws.send(JSON.stringify(payload));
    return p;
  }

  _onSessionEvent(
    sessionId: string,
    event: string,
    handler: EventHandler,
  ): void {
    const key = `${sessionId}:${event}`;
    const set = this.eventHandlers.get(key) ?? new Set<EventHandler>();
    set.add(handler);
    this.eventHandlers.set(key, set);
  }

  _offSessionEvent(
    sessionId: string,
    event: string,
    handler: EventHandler,
  ): void {
    const key = `${sessionId}:${event}`;
    const set = this.eventHandlers.get(key);
    if (set) set.delete(handler);
  }

  _dispatchToSession(sessionId: string, event: string, params: unknown): void {
    const key = `${sessionId}:${event}`;
    const handlers = this.eventHandlers.get(key);
    if (handlers) for (const h of handlers) h(params);
  }
}

export class CdpSession implements CDPSessionLike {
  constructor(
    private readonly root: CdpConnection,
    public readonly id: string,
  ) {}

  send<R = unknown>(method: string, params?: object): Promise<R> {
    return this.root._sendViaSession<R>(this.id, method, params);
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    this.root._onSessionEvent(this.id, event, handler as EventHandler);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.root._offSessionEvent(this.id, event, handler as EventHandler);
  }

  async close(): Promise<void> {
    await this.root.send<void>("Target.detachFromTarget", {
      sessionId: this.id,
    });
  }

  dispatch(event: string, params: unknown): void {
    this.root._dispatchToSession(this.id, event, params);
  }
}
