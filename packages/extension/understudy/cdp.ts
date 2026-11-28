import type { Protocol } from "devtools-protocol";
import { z } from "zod/v4";
import type { StagehandLogger } from "../logger.js";

export interface CDPSessionLike {
  send<R = unknown>(method: string, params?: object): Promise<R>;
  on<P = unknown>(event: string, handler: (params: P) => void): void;
  off<P = unknown>(event: string, handler: (params: P) => void): void;
  close(): Promise<void>;
  readonly id: string | null;
}

export function isCdpClosedError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith("CDP connection closed:") ||
      error.message.startsWith("No Page found for target closed before CDP "))
  );
}

export type CdpWebSocketCloseEvent = {
  code: number;
  reason: string;
};

export interface CdpWebSocketTransport {
  readonly connected: boolean;
  send(payload: string): void;
  close(): Promise<void>;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void;
  onError(handler: (error: Error) => void): void;
}

export type CdpWebSocketFactory = (url: string) => Promise<CdpWebSocketTransport>;

type Inflight = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  sessionId?: string | null;
  method: string;
  params?: object;
  stack?: string;
  ts: number;
  logger: CdpTelemetryLogger;
};

type CdpTelemetryLogger = Pick<StagehandLogger, "debug" | "error">;

type EventHandler = (params: unknown) => void;
type SessionDispatchWaiter = {
  sessionId: string;
  method: string;
  match?: (params?: object) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

const CdpErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

const CdpResponseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: CdpErrorSchema.optional(),
  sessionId: z.string().optional(),
});

const CdpEventSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
});

const RawMessageSchema = z.union([CdpResponseSchema, CdpEventSchema]);
type RawMessage = z.infer<typeof RawMessageSchema>;

function isExpectedReleaseObjectCleanupError(
  method: string,
  error: { code: number; message: string },
): boolean {
  return (
    method === "Runtime.releaseObject" &&
    error.code === -32000 &&
    error.message.includes("Cannot find context with specified id")
  );
}

export class CdpConnection implements CDPSessionLike {
  messageQueue: Promise<void> = Promise.resolve();
  nextId = 1;
  inflight = new Map<number, Inflight>();
  eventHandlers = new Map<string, Set<EventHandler>>();
  sessions = new Map<string, CdpSession>();
  sessionToTarget = new Map<string, string>();
  sessionDispatchWaiters = new Set<SessionDispatchWaiter>();
  public readonly id: string | null = null;
  transportCloseHandlers = new Set<(why: string) => void>();
  private readonly telemetryScopes = new Map<symbol, CdpTelemetryLogger[]>();
  private terminated = false;

  get connected(): boolean {
    return this.transport.connected;
  }

  public onTransportClosed(handler: (why: string) => void): void {
    this.transportCloseHandlers.add(handler);
  }
  public offTransportClosed(handler: (why: string) => void): void {
    this.transportCloseHandlers.delete(handler);
  }

  emitTransportClosed(why: string) {
    for (const h of this.transportCloseHandlers) {
      try {
        h(why);
      } catch {}
    }
  }

  constructor(
    readonly transport: CdpWebSocketTransport,
    readonly logger: CdpTelemetryLogger,
  ) {
    this.transport.onClose((event) => {
      this.terminated = true;
      const why = `socket-close code=${String(event.code)} reason=${event.reason}`;
      this.rejectAllInflight(why);
      this.emitTransportClosed(why);
    });

    this.transport.onError((error) => {
      this.terminated = true;
      const why = `socket-error ${error.message}`;
      this.rejectAllInflight(why);
      this.emitTransportClosed(why);
    });
    this.transport.onMessage((data) => {
      this.messageQueue = this.messageQueue
        .then(() => {
          if (this.terminated) return;
          this.onMessage(data);
        })
        .catch((error: unknown) => {
          this.terminated = true;
          const why = `socket-message-error ${error instanceof Error ? error.message : String(error)}`;
          this.rejectAllInflight(why);
          this.emitTransportClosed(why);
          void this.transport.close().catch(() => {});
        });
    });
  }

  static async connect(
    wsUrl: string,
    websocketFactory: CdpWebSocketFactory,
    logger: CdpTelemetryLogger,
  ): Promise<CdpConnection> {
    const transport = await websocketFactory(wsUrl);
    return new CdpConnection(transport, logger);
  }

  async runWithTelemetryContext<Result>(
    scope: symbol,
    logger: CdpTelemetryLogger,
    run: () => Result | Promise<Result>,
  ): Promise<Result> {
    const stack = this.telemetryScopes.get(scope) ?? [];
    stack.push(logger);
    this.telemetryScopes.set(scope, stack);
    try {
      return await run();
    } finally {
      stack.pop();
      if (stack.length === 0) this.telemetryScopes.delete(scope);
    }
  }

  private telemetryLogger(): CdpTelemetryLogger {
    if (this.telemetryScopes.size !== 1) return this.logger;
    const stack = this.telemetryScopes.values().next().value;
    return stack?.[stack.length - 1] ?? this.logger;
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
    const logger = this.telemetryLogger();
    logger.debug("CDP call", {
      requestId: id,
      method,
      sessionId: null,
      targetId: null,
      params: JSON.stringify(params ?? {}),
    });
    const p = new Promise<unknown>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        sessionId: null,
        method,
        params,
        stack,
        ts: Date.now(),
        logger,
      });
    });
    // Prevent unhandledRejection if a session detaches before the caller awaits.
    void p.catch(() => {});
    try {
      this.transport.send(JSON.stringify(payload));
    } catch (error) {
      this.inflight.delete(id);
      throw error;
    }
    return p as Promise<R>;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.eventHandlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event);
    if (!set) return;
    set.delete(handler as EventHandler);
    if (set.size === 0) this.eventHandlers.delete(event);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  rejectAllInflight(why: string): void {
    for (const [id, entry] of this.inflight.entries()) {
      entry.reject(new Error(`CDP connection closed: ${why}`));
      this.inflight.delete(id);
    }
    for (const waiter of Array.from(this.sessionDispatchWaiters)) {
      waiter.reject(new Error(`CDP connection closed: ${why}`));
    }
  }

  clearSessionEventHandlers(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of Array.from(this.eventHandlers.keys())) {
      if (key.startsWith(prefix)) {
        this.eventHandlers.delete(key);
      }
    }
  }

  rejectSessionPendingWork(sessionId: string, targetId: string | null): void {
    for (const [id, entry] of this.inflight.entries()) {
      if (entry.sessionId === sessionId) {
        entry.reject(
          new Error(
            `No Page found for target closed before CDP response (sessionId=${sessionId}, targetId=${targetId})`,
          ),
        );
        this.inflight.delete(id);
      }
    }
    for (const waiter of Array.from(this.sessionDispatchWaiters)) {
      if (waiter.sessionId === sessionId) {
        waiter.reject(
          new Error(
            `No Page found for target closed before CDP send (sessionId=${sessionId}, targetId=${targetId})`,
          ),
        );
      }
    }
  }

  detachSession(
    sessionId: string,
    targetId: string | null = this.sessionToTarget.get(sessionId) ?? null,
  ): void {
    this.rejectSessionPendingWork(sessionId, targetId);
    this.clearSessionEventHandlers(sessionId);
    this.sessions.delete(sessionId);
    this.sessionToTarget.delete(sessionId);
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
    const { sessionId } = (await this.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };

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

  targetIdForSession(sessionId?: string | null): string | null {
    if (!sessionId) return null;
    return this.sessionToTarget.get(sessionId) ?? sessionId;
  }

  onMessage(json: string): void {
    const msg: RawMessage = RawMessageSchema.parse(JSON.parse(json));

    if ("id" in msg) {
      const rec = this.inflight.get(msg.id);
      if (!rec) return;

      this.inflight.delete(msg.id);

      if ("error" in msg && msg.error) {
        const data = {
          requestId: msg.id,
          method: rec.method,
          error: `${msg.error.code} ${msg.error.message}`,
          targetId: this.targetIdForSession(rec.sessionId),
        };

        if (isExpectedReleaseObjectCleanupError(rec.method, msg.error)) {
          rec.logger.debug("CDP releaseObject cleanup raced with context destruction", data);
        } else {
          rec.logger.error("CDP response failed", data);
        }

        rec.reject(new Error(`${msg.error.code} ${msg.error.message}`));
      } else {
        rec.logger.debug("CDP response", {
          requestId: msg.id,
          method: rec.method,
          targetId: this.targetIdForSession(rec.sessionId),
        });
        rec.resolve((msg as { result?: unknown }).result);
      }
      return;
    }

    if ("method" in msg) {
      if (msg.method === "Target.attachedToTarget") {
        const p = (msg as { params: Protocol.Target.AttachedToTargetEvent }).params;
        if (!this.sessions.has(p.sessionId)) {
          this.sessions.set(p.sessionId, new CdpSession(this, p.sessionId));
        }
        this.sessionToTarget.set(p.sessionId, p.targetInfo.targetId);
      } else if (msg.method === "Target.detachedFromTarget") {
        const p = (msg as { params: { sessionId: string; targetId?: string } }).params;
        this.detachSession(
          p.sessionId,
          p.targetId ?? this.sessionToTarget.get(p.sessionId) ?? null,
        );
      } else if (msg.method === "Target.targetDestroyed") {
        const p = (msg as { params: { targetId: string } }).params;
        for (const [sessionId, targetId] of Array.from(this.sessionToTarget.entries())) {
          if (targetId === p.targetId) {
            this.detachSession(sessionId, p.targetId);
          }
        }
      }

      const { method, params, sessionId } = msg;
      this.telemetryLogger().debug("CDP message", {
        method,
        sessionId: sessionId ?? null,
        targetId: this.targetIdForSession(sessionId),
        params: JSON.stringify(params ?? {}),
      });

      const dispatch = () => {
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          session?.dispatch(method, params);

          // Forward target lifecycle events to root listeners as well.
          // Some browsers emit these via a parent session rather than the root
          // connection; fan-out keeps target tracking consistent.
          if (method.startsWith("Target.")) {
            this.emitHandlers(this.eventHandlers.get(method), params);
          }
          return;
        }

        this.emitHandlers(this.eventHandlers.get(method), params);
      };

      dispatch();
    }
  }

  _sendViaSession<R = unknown>(sessionId: string, method: string, params?: object): Promise<R> {
    const id = this.nextId++;
    const payload = { id, method, params, sessionId };
    const stack = new Error().stack?.split("\n").slice(1, 4).join("\n");
    const logger = this.telemetryLogger();
    logger.debug("CDP call", {
      requestId: id,
      method,
      sessionId,
      targetId: this.targetIdForSession(sessionId),
      params: JSON.stringify(params ?? {}),
    });

    const p = new Promise<unknown>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        sessionId,
        method,
        params,
        stack,
        ts: Date.now(),
        logger,
      });
    });
    // Prevent unhandledRejection if a session detaches before the caller awaits.
    void p.catch(() => {});
    try {
      this.transport.send(JSON.stringify(payload));
    } catch (error) {
      this.inflight.delete(id);
      const rejection = error instanceof Error ? error : new Error(String(error));
      for (const waiter of Array.from(this.sessionDispatchWaiters)) {
        if (waiter.sessionId !== sessionId) continue;
        if (waiter.method !== method) continue;
        if (waiter.match && !waiter.match(params)) continue;
        waiter.reject(rejection);
        break;
      }
      throw error;
    }
    for (const waiter of Array.from(this.sessionDispatchWaiters)) {
      if (waiter.sessionId !== sessionId) continue;
      if (waiter.method !== method) continue;
      if (waiter.match && !waiter.match(params)) continue;
      waiter.resolve();
      break;
    }
    return p as Promise<R>;
  }

  _onSessionEvent(sessionId: string, event: string, handler: EventHandler): void {
    const key = `${sessionId}:${event}`;
    const set = this.eventHandlers.get(key) ?? new Set<EventHandler>();
    set.add(handler);
    this.eventHandlers.set(key, set);
  }

  _offSessionEvent(sessionId: string, event: string, handler: EventHandler): void {
    const key = `${sessionId}:${event}`;
    const set = this.eventHandlers.get(key);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.eventHandlers.delete(key);
  }

  _dispatchToSession(sessionId: string, event: string, params: unknown): void {
    const key = `${sessionId}:${event}`;
    this.emitHandlers(this.eventHandlers.get(key), params);
  }

  private emitHandlers(handlers: Set<EventHandler> | undefined, params: unknown): void {
    if (!handlers) return;
    for (const h of Array.from(handlers)) {
      if (!handlers.has(h)) continue;
      try {
        h(params);
      } catch (error) {
        this.logger.error("CDP event listener threw", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export class CdpSession implements CDPSessionLike {
  constructor(
    readonly root: CdpConnection,
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
    try {
      await this.root.send<void>("Target.detachFromTarget", {
        sessionId: this.id,
      });
    } finally {
      this.root.detachSession(this.id);
    }
  }

  dispatch(event: string, params: unknown): void {
    this.root._dispatchToSession(this.id, event, params);
  }
}
