// lib/v3/understudy/cdp.ts
import WebSocket from "ws";
import type { Protocol } from "devtools-protocol";

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
};

type EventHandler = (params: unknown) => void;

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
  private inflight = new Map<number, Inflight>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private sessions = new Map<string, CdpSession>();
  /** Maps sessionId -> targetId (1:1 mapping) */
  private sessionToTarget = new Map<string, string>();
  public readonly id: string | null = null; // root
  private transportCloseHandlers = new Set<(why: string) => void>();

  /** Optional CDP logger - set this to receive all outgoing CDP method calls */
  public cdpLogger?: (info: {
    method: string;
    params?: object;
    targetId?: string | null;
  }) => void;

  /** Optional CDP event logger - set this to receive all incoming CDP events */
  public cdpEventLogger?: (info: {
    method: string;
    params?: unknown;
    targetId?: string | null;
  }) => void;

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
      this.emitTransportClosed(why);
    });

    this.ws.on("error", (err) => {
      const why = `socket-error ${err?.message ?? String(err)}`;
      this.emitTransportClosed(why);
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
  }

  static async connect(wsUrl: string): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
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
      waitForDebuggerOnStart: false,
      filter: [
        { type: "worker", exclude: true },
        { type: "shared_worker", exclude: true },
        { type: "service_worker", exclude: true },
      ],
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
  }

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const stack = new Error().stack?.split("\n").slice(1, 4).join("\n");
    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        sessionId: null,
        method,
        params,
        stack,
        ts: Date.now(),
      });
    });
    this.cdpLogger?.({ method, params, targetId: null });
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
    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  getSession(sessionId: string): CdpSession | undefined {
    return this.sessions.get(sessionId);
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
        rec.reject(new Error(`${msg.error.code} ${msg.error.message}`));
      } else {
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
            entry.reject(new Error("CDP session detached"));
            this.inflight.delete(id);
          }
        }
        this.sessions.delete(p.sessionId);
        this.sessionToTarget.delete(p.sessionId);
      } else if (msg.method === "Target.targetDestroyed") {
        const p = (msg as { params: { targetId: string } }).params;
        // Remove any session mapping for this target
        for (const [sessionId, targetId] of this.sessionToTarget.entries()) {
          if (targetId === p.targetId) {
            this.sessionToTarget.delete(sessionId);
            break;
          }
        }
      }

      const { method, params, sessionId } = msg;

      // Log incoming CDP events
      const targetId = this.sessionToTarget.get(sessionId) || sessionId;
      this.cdpEventLogger?.({ method, params, targetId });

      if (sessionId) {
        const session = this.sessions.get(sessionId);
        session?.dispatch(method, params);
      } else {
        const handlers = this.eventHandlers.get(method);
        if (handlers) for (const h of handlers) h(params);
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

    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        sessionId,
        method,
        params,
        stack,
        ts: Date.now(),
      });
    });
    const targetId = this.sessionToTarget.get(sessionId) ?? null;
    this.cdpLogger?.({ method, params, targetId });
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
