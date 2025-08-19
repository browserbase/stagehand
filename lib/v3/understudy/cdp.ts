// cdp.ts
import WebSocket from "ws";
import type { Protocol } from "devtools-protocol";

export interface CDPSessionLike {
  send<R = unknown>(method: string, params?: object): Promise<R>;
  on<P = unknown>(event: string, handler: (params: P) => void): void;
  off<P = unknown>(event: string, handler: (params: P) => void): void;
  close(): Promise<void>;
  readonly id: string | null; // null for root (browser) session
}

type Inflight = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
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
  public readonly id: string | null = null; // root

  private constructor(ws: WebSocket) {
    this.ws = ws;
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

  /** Enable auto-attach to all existing/future targets (flattened sessions). */
  async enableAutoAttach(): Promise<void> {
    await this.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
  }

  /** Root send (no sessionId). */
  async send<R = unknown>(method: string, params?: object): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: (v) => resolve(v as R),
        reject,
      });
    });
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

  /** Return an attached session by id (useful after Target.attachedToTarget). */
  getSession(sessionId: string): CdpSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Attach to a target and get a per-target session (flattened). */
  async attachToTarget(targetId: string): Promise<CdpSession> {
    const { sessionId } = (await this.send<{ sessionId: string }>(
      "Target.attachToTarget",
      {
        targetId,
        flatten: true,
      },
    )) as { sessionId: string };

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new CdpSession(this, sessionId);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /** Helper to list targets. */
  async getTargets(): Promise<
    Array<{ targetId: string; type: string; url: string }>
  > {
    const res = (await this.send<{
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    }>("Target.getTargets")) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>;
    };
    return res.targetInfos;
  }

  // Internal dispatch
  private onMessage(json: string): void {
    const msg = JSON.parse(json) as RawMessage;

    // Response path
    if ("id" in msg) {
      const inflight = this.inflight.get(msg.id);
      if (!inflight) return;

      this.inflight.delete(msg.id);
      if ("error" in msg && msg.error) {
        inflight.reject(new Error(`${msg.error.code} ${msg.error.message}`));
      } else {
        inflight.resolve((msg as { result?: unknown }).result);
      }
      return;
    }

    // Event path
    if ("method" in msg) {
      // Adopt/dismiss sessions for auto-attach lifecycle
      if (msg.method === "Target.attachedToTarget") {
        const p = (msg as { params: Protocol.Target.AttachedToTargetEvent })
          .params;
        // p.sessionId is the new child session id (flattened)
        if (!this.sessions.has(p.sessionId)) {
          this.sessions.set(p.sessionId, new CdpSession(this, p.sessionId));
        }
      } else if (msg.method === "Target.detachedFromTarget") {
        const p = (msg as { params: Protocol.Target.DetachedFromTargetEvent })
          .params;
        // Remove child session
        this.sessions.delete(p.sessionId);
      }

      const { method, params, sessionId } = msg;

      if (sessionId) {
        // Deliver to session listeners
        const session = this.sessions.get(sessionId);
        session?.dispatch(method, params);
      } else {
        // Deliver to root listeners
        const handlers = this.eventHandlers.get(method);
        if (handlers) for (const h of handlers) h(params);
      }
    }
  }

  // Used by CdpSession to send with sessionId
  _sendViaSession<R = unknown>(
    sessionId: string,
    method: string,
    params?: object,
  ): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params, sessionId };
    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: (v) => resolve(v as R),
        reject,
      });
    });
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

  // internal from root
  dispatch(event: string, params: unknown): void {
    this.root._dispatchToSession(this.id, event, params);
  }
}
