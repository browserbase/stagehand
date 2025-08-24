import WebSocket from "ws";
import type { Protocol } from "devtools-protocol";

/**
 * CDP transport & session multiplexer
 *
 * Purpose:
 * A minimal, dependency-free wrapper over the Chrome DevTools Protocol (CDP)
 * that maintains a single WebSocket connection to the browser, and multiplexes
 * per-target “flattened” child sessions (Target domain).
 *
 * What it does:
 * - Opens a single WS to the browser and routes request/response messages.
 * - Tracks inflight CDP calls so responses resolve/reject the correct promise.
 * - Creates lightweight CdpSession objects for child sessions and dispatches
 *   their events via a simple event emitter API.
 * - Supports “pause-then-resume” target onboarding (used by Context to wire
 *   listeners before resuming a target via Runtime.runIfWaitingForDebugger).
 *
 * What it does NOT do:
 * - It does not interpret Page/DOM/Runtime semantics — callers own that logic.
 * - It does not implement retry/backoff — callers decide error policy.
 */

export interface CDPSessionLike {
  /**
   * Send a CDP command on this session (root or child).
   * @param method CDP method name (e.g., "Page.enable")
   * @param params Optional params object for the command
   */
  send<R = unknown>(method: string, params?: object): Promise<R>;

  /**
   * Subscribe to a CDP event on this session (root or child).
   * @param event CDP event name (e.g., "Page.frameNavigated")
   * @param handler Listener invoked with the event payload
   */
  on<P = unknown>(event: string, handler: (params: P) => void): void;

  /**
   * Unsubscribe a previously registered listener.
   */
  off<P = unknown>(event: string, handler: (params: P) => void): void;

  /**
   * Gracefully close this session (Target.detachFromTarget).
   */
  close(): Promise<void>;

  /**
   * Session id for child sessions, null for the root (browser) connection.
   */
  readonly id: string | null; // null for root (browser) session
}

type Inflight = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** Non-null when the request was sent via a child session. */
  sessionId?: string | null;
  /** CDP method name used (diagnostic only). */
  method: string;
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

/**
 * Root CDP connection that owns the browser WebSocket and multiplexes child sessions.
 */
export class CdpConnection implements CDPSessionLike {
  private ws: WebSocket;
  private nextId = 1;
  private inflight = new Map<number, Inflight>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private sessions = new Map<string, CdpSession>();
  /** Root session has id === null; only child sessions have an id string. */
  public readonly id: string | null = null; // root

  /**
   * Construct a connection around an already-open WebSocket.
   */
  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (data) => this.onMessage(data.toString()));
  }

  /**
   * Open a WebSocket to the browser’s CDP endpoint and return a connection.
   * @param wsUrl ws(s)://…/devtools/browser/<id> (from /json/version)
   */
  static async connect(wsUrl: string): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(e));
    });
    return new CdpConnection(ws);
  }

  /**
   * Enable auto-attach for existing/future targets with flattened sessions,
   * and pause newly created targets until callers wire listeners and resume.
   * Callers typically follow with Runtime.runIfWaitingForDebugger per target.
   */
  async enableAutoAttach(): Promise<void> {
    await this.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      // Pause new targets so the runtime can wire listeners before resuming.
      waitForDebuggerOnStart: true,
      // Exclude noisy worker targets; attach to everything page-like.
      filter: [
        { type: "worker", exclude: true },
        { type: "shared_worker", exclude: true },
        { type: "service_worker", exclude: true },
      ],
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
  }

  /**
   * Send a CDP command on the **root** (browser) session.
   * @param method CDP method name (e.g., "Target.getTargets")
   * @param params Optional params for the command
   */
  async send<R = unknown>(method: string, params?: object): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const p = new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: (v) => resolve(v as R),
        reject,
        sessionId: null,
        method,
      });
    });
    this.ws.send(JSON.stringify(payload));
    return p;
  }

  /**
   * Subscribe to a **root-level** event (events with no sessionId).
   */
  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.eventHandlers.set(event, set);
  }

  /**
   * Unsubscribe a previously registered root-level listener.
   */
  off<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event);
    if (set) set.delete(handler as EventHandler);
  }

  /**
   * Close the browser WebSocket gracefully.
   */
  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  /**
   * Lookup an attached child session by id.
   * @param sessionId CDP session id from Target.attachedToTarget
   */
  getSession(sessionId: string): CdpSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Explicitly attach to a target id and return its child session.
   * @param targetId A target id from Target.getTargets / Target.targetCreated
   */
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
    return session;
  }

  /**
   * Return a static snapshot of known targets from Target.getTargets.
   * Useful during bootstrap to attach to pre-existing targets.
   */
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

  // ---------- Internal dispatch ----------

  /**
   * Internal message router: resolves inflight calls or dispatches events
   * to root listeners or to the appropriate child session.
   */
  private onMessage(json: string): void {
    const msg = JSON.parse(json) as RawMessage;

    // Response path: resolve/reject the matching inflight promise.
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

    // Event path: create/remove sessions and deliver events.
    if ("method" in msg) {
      if (msg.method === "Target.attachedToTarget") {
        const p = (msg as { params: Protocol.Target.AttachedToTargetEvent })
          .params;
        // Create a new child session object; Context will wire listeners & resume later.
        if (!this.sessions.has(p.sessionId)) {
          this.sessions.set(p.sessionId, new CdpSession(this, p.sessionId));
        }
      } else if (msg.method === "Target.detachedFromTarget") {
        const p = (msg as { params: Protocol.Target.DetachedFromTargetEvent })
          .params;
        // Reject all inflights for this session to avoid hangs.
        for (const [id, entry] of this.inflight.entries()) {
          if (entry.sessionId === p.sessionId) {
            entry.reject(new Error("CDP session detached"));
            this.inflight.delete(id);
          }
        }
        this.sessions.delete(p.sessionId);
      }

      const { method, params, sessionId } = msg;

      if (sessionId) {
        // Child session event.
        const session = this.sessions.get(sessionId);
        session?.dispatch(method, params);
      } else {
        // Root-level event.
        const handlers = this.eventHandlers.get(method);
        if (handlers) for (const h of handlers) h(params);
      }
    }
  }

  /**
   * Send a CDP command via a specific child session.
   * Used internally by CdpSession.send.
   */
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
        sessionId,
        method,
      });
    });
    this.ws.send(JSON.stringify(payload));
    return p;
  }

  /**
   * Register an event handler for a child session (namespaced by sessionId).
   */
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

  /**
   * Unregister a child-session event handler.
   */
  _offSessionEvent(
    sessionId: string,
    event: string,
    handler: EventHandler,
  ): void {
    const key = `${sessionId}:${event}`;
    const set = this.eventHandlers.get(key);
    if (set) set.delete(handler);
  }

  /**
   * Dispatch a child-session event to registered listeners.
   */
  _dispatchToSession(sessionId: string, event: string, params: unknown): void {
    const key = `${sessionId}:${event}`;
    const handlers = this.eventHandlers.get(key);
    if (handlers) for (const h of handlers) h(params);
  }
}

/**
 * Lightweight proxy for a child session; delegates to the root connection.
 */
export class CdpSession implements CDPSessionLike {
  constructor(
    private readonly root: CdpConnection,
    /** CDP session id (from Target.attachedToTarget). */
    public readonly id: string,
  ) {}

  /**
   * Send a CDP command on this child session.
   */
  send<R = unknown>(method: string, params?: object): Promise<R> {
    return this.root._sendViaSession<R>(this.id, method, params);
  }

  /**
   * Subscribe to a CDP event on this child session.
   */
  on<P = unknown>(event: string, handler: (params: P) => void): void {
    this.root._onSessionEvent(this.id, event, handler as EventHandler);
  }

  /**
   * Unsubscribe a previously registered listener on this child session.
   */
  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.root._offSessionEvent(this.id, event, handler as EventHandler);
  }

  /**
   * Detach from the underlying target (Target.detachFromTarget).
   */
  async close(): Promise<void> {
    await this.root.send<void>("Target.detachFromTarget", {
      sessionId: this.id,
    });
  }

  /**
   * Internal: deliver an event to listeners registered for this session.
   */
  dispatch(event: string, params: unknown): void {
    this.root._dispatchToSession(this.id, event, params);
  }
}
