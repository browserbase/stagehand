import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserWebSocketFactory } from "./browserWebSocketTransport.js";
import {
  CdpConnection,
  type CdpSession,
  type CdpWebSocketCloseEvent,
  type CdpWebSocketTransport,
} from "./cdp.js";

const discardLogger = {
  debug: () => {},
  error: () => {},
};

class ProgrammableCdpTransport implements CdpWebSocketTransport {
  connected = true;
  readonly sent: string[] = [];
  closeCalls = 0;
  throwOnNextSend = false;
  private messageHandler?: (data: string) => void;
  private closeHandler?: (event: CdpWebSocketCloseEvent) => void;
  private errorHandler?: (error: Error) => void;

  send(payload: string): void {
    if (this.throwOnNextSend) {
      this.throwOnNextSend = false;
      throw new Error("transport send failure");
    }
    if (!this.connected) {
      throw new Error("transport is closed");
    }
    this.sent.push(payload);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (!this.connected) return;
    this.connected = false;
    this.closeHandler?.({ code: 1000, reason: "normal" });
  }

  emitMessage(data: string): void {
    this.messageHandler?.(data);
  }

  emitClose(code: number, reason: string): void {
    this.connected = false;
    this.closeHandler?.({ code, reason });
  }

  emitError(message: string): void {
    this.connected = false;
    this.errorHandler?.(new Error(message));
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
}

type CdpAction =
  | { type: "attach"; sessionIdx: number; targetIdx: number }
  | { type: "send"; targetSession: number | null; failSend: boolean }
  | {
      type: "respond";
      callIdx: number;
      pool: "pending" | "settled" | "unknown";
      kind: "ok" | "error" | "releaseObjectRace";
    }
  | {
      type: "event";
      targetSession: number | null;
      eventName: "Page.loadEventFired" | "Target.targetInfoChanged";
    }
  | {
      type: "addListener";
      targetSession: number | null;
      eventName: "Page.loadEventFired" | "Target.targetInfoChanged";
      behavior: "record" | "removeSelf" | "readdSelf" | "addSibling" | "throw";
    }
  | { type: "removeAllListeners" }
  | { type: "addDispatchWaiter"; sessionIdx: number }
  | { type: "detachEvent"; sessionIdx: number }
  | { type: "destroyTarget"; targetIdx: number }
  | { type: "sessionClose"; sessionIdx: number; emitDetachedEvent: boolean }
  | { type: "malformedFrame"; variant: "badJson" | "badEnvelope" | "missingTargetParams" }
  | { type: "transportDrop"; mode: "close" | "error" };

const cdpActionArb: fc.Arbitrary<CdpAction> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("attach" as const),
      sessionIdx: fc.integer({ min: 1, max: 4 }),
      targetIdx: fc.integer({ min: 1, max: 3 }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant("send" as const),
      targetSession: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 4 })),
      failSend: fc.constantFrom(false, false, false, true),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constant("respond" as const),
      callIdx: fc.integer({ min: 0, max: 12 }),
      pool: fc.constantFrom(
        "pending" as const,
        "pending" as const,
        "settled" as const,
        "unknown" as const,
      ),
      kind: fc.constantFrom("ok" as const, "error" as const, "releaseObjectRace" as const),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("event" as const),
      targetSession: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 4 })),
      eventName: fc.constantFrom(
        "Page.loadEventFired" as const,
        "Target.targetInfoChanged" as const,
      ),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("addListener" as const),
      targetSession: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 4 })),
      eventName: fc.constantFrom(
        "Page.loadEventFired" as const,
        "Target.targetInfoChanged" as const,
      ),
      behavior: fc.constantFrom(
        "record" as const,
        "removeSelf" as const,
        "readdSelf" as const,
        "addSibling" as const,
        "throw" as const,
      ),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: "removeAllListeners" as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("addDispatchWaiter" as const),
      sessionIdx: fc.integer({ min: 1, max: 4 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("detachEvent" as const),
      sessionIdx: fc.integer({ min: 1, max: 4 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("destroyTarget" as const),
      targetIdx: fc.integer({ min: 1, max: 3 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("sessionClose" as const),
      sessionIdx: fc.integer({ min: 1, max: 4 }),
      emitDetachedEvent: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("malformedFrame" as const),
      variant: fc.constantFrom(
        "badJson" as const,
        "badEnvelope" as const,
        "missingTargetParams" as const,
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("transportDrop" as const),
      mode: fc.constantFrom("close" as const, "error" as const),
    }),
  },
);

async function drainQueue(connection: CdpConnection): Promise<void> {
  await connection.messageQueue;
  await Promise.resolve();
  await Promise.resolve();
}

class ControllableWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControllableWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = ControllableWebSocket.CONNECTING;
  binaryType = "blob";

  constructor(readonly url: string) {
    super();
    ControllableWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== ControllableWebSocket.CONNECTING) return;
      this.readyState = ControllableWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    if (this.readyState === ControllableWebSocket.CLOSED) return;
    this.readyState = ControllableWebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "" }));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class AsyncDelayBlob extends Blob {
  constructor(
    parts: BlobPart[],
    readonly delayTicks: number,
  ) {
    super(parts);
  }

  override async text(): Promise<string> {
    for (let i = 0; i < this.delayTicks; i++) {
      await Promise.resolve();
    }
    return await super.text();
  }
}

describe("CDP multiplexer and BrowserWebSocketTransport properties", () => {
  afterEach(() => {
    try {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces session isolation, listener mutation/throw safety, and zero map leaks across CDP interleavings", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(cdpActionArb, { minLength: 1, maxLength: 35 }),
          async (actions) => {
            const transport = new ProgrammableCdpTransport();
            const connection = new CdpConnection(transport, discardLogger);

            type CallRec = {
              id: number;
              sessionId: string | null;
              settledCount: number;
              status: "pending" | "resolved" | "rejected";
              promise: Promise<void>;
            };

            type RegisteredListener = {
              sessionId: string | null;
              eventName: string;
              handler: (params: unknown) => void;
            };

            const calls: CallRec[] = [];
            const listeners: RegisteredListener[] = [];
            const waiters: Array<{
              sessionId: string;
              status: "pending" | "resolved" | "rejected";
              promise: Promise<void>;
            }> = [];
            const siblingFiredUnexpectedly: string[] = [];

            const getTarget = (sessionId: string | null): CdpConnection | CdpSession | undefined =>
              sessionId === null ? connection : connection.getSession(sessionId);

            for (const action of actions) {
              switch (action.type) {
                case "attach": {
                  if (!transport.connected) break;
                  const sessionId = `sess-${action.sessionIdx}`;
                  const targetId = `target-${action.targetIdx}`;
                  transport.emitMessage(
                    JSON.stringify({
                      method: "Target.attachedToTarget",
                      params: {
                        sessionId,
                        targetInfo: {
                          targetId,
                          type: "page",
                          title: "",
                          url: "about:blank",
                          attached: true,
                          canAccessOpener: false,
                        },
                        waitingForDebugger: false,
                      },
                    }),
                  );
                  await drainQueue(connection);
                  expect(connection.getSession(sessionId)).toBeDefined();
                  break;
                }

                case "send": {
                  const sessionId =
                    action.targetSession === null ? null : `sess-${action.targetSession}`;
                  const target = getTarget(sessionId);
                  if (!target) break;
                  const id = connection.nextId;
                  const method = action.failSend ? "Runtime.evaluate" : "Runtime.releaseObject";
                  if (action.failSend) transport.throwOnNextSend = true;

                  const rec: CallRec = {
                    id,
                    sessionId,
                    settledCount: 0,
                    status: "pending",
                    promise: Promise.resolve(),
                  };
                  const rawPromise = Promise.resolve().then(() => target.send(method, { n: id }));
                  rec.promise = rawPromise.then(
                    () => {
                      rec.settledCount += 1;
                      rec.status = "resolved";
                    },
                    () => {
                      rec.settledCount += 1;
                      rec.status = "rejected";
                    },
                  );
                  calls.push(rec);
                  for (let i = 0; i < 6; i++) await Promise.resolve();

                  if (action.failSend || !transport.connected) {
                    expect(connection.inflight.has(id)).toBe(false);
                    expect(rec.status).toBe("rejected");
                  }
                  break;
                }

                case "respond": {
                  if (!transport.connected) break;
                  const pool =
                    action.pool === "pending"
                      ? calls.filter((c) => c.status === "pending")
                      : action.pool === "settled"
                        ? calls.filter((c) => c.status !== "pending")
                        : [];
                  const target = pool.length > 0 ? pool[action.callIdx % pool.length] : undefined;
                  const id = target ? target.id : 50_000 + action.callIdx;
                  const frame =
                    action.kind === "ok"
                      ? {
                          id,
                          result: { ok: id },
                          ...(target?.sessionId ? { sessionId: target.sessionId } : {}),
                        }
                      : action.kind === "releaseObjectRace"
                        ? {
                            id,
                            error: {
                              code: -32000,
                              message: "Cannot find context with specified id",
                            },
                          }
                        : { id, error: { code: -32000, message: `err-${id}` } };
                  transport.emitMessage(JSON.stringify(frame));
                  await drainQueue(connection);
                  break;
                }

                case "event": {
                  if (!transport.connected) break;
                  const sessionId =
                    action.targetSession === null ? null : `sess-${action.targetSession}`;
                  const pendingBefore = calls.filter((c) => c.status === "pending").length;
                  transport.emitMessage(
                    JSON.stringify({
                      method: action.eventName,
                      params: { ts: 1 },
                      ...(sessionId ? { sessionId } : {}),
                    }),
                  );
                  await drainQueue(connection);
                  expect(transport.connected).toBe(true);
                  expect(calls.filter((c) => c.status === "pending").length).toBe(pendingBefore);
                  break;
                }

                case "addListener": {
                  const sessionId =
                    action.targetSession === null ? null : `sess-${action.targetSession}`;
                  const target = getTarget(sessionId);
                  if (!target) break;

                  let handler: (params: unknown) => void;
                  switch (action.behavior) {
                    case "record":
                      handler = () => {};
                      break;
                    case "removeSelf":
                      handler = () => {
                        target.off(action.eventName, handler);
                      };
                      break;
                    case "readdSelf":
                      handler = () => {
                        target.off(action.eventName, handler);
                        target.on(action.eventName, handler);
                      };
                      break;
                    case "addSibling":
                      handler = () => {
                        let siblingRanDuringSameEvent = true;
                        const sibling = () => {
                          if (siblingRanDuringSameEvent) {
                            siblingFiredUnexpectedly.push(
                              `${sessionId ?? "root"}:${action.eventName}`,
                            );
                          }
                        };
                        target.on(action.eventName, sibling);
                        listeners.push({
                          sessionId,
                          eventName: action.eventName,
                          handler: sibling,
                        });
                        queueMicrotask(() => {
                          siblingRanDuringSameEvent = false;
                        });
                      };
                      break;
                    case "throw":
                      handler = () => {
                        throw new Error("listener exploded");
                      };
                      break;
                    default: {
                      const exhaustive: never = action.behavior;
                      return exhaustive;
                    }
                  }

                  target.on(action.eventName, handler);
                  listeners.push({ sessionId, eventName: action.eventName, handler });
                  break;
                }

                case "removeAllListeners": {
                  for (const entry of listeners.splice(0)) {
                    if (entry.sessionId === null) {
                      connection.off(entry.eventName, entry.handler);
                    } else {
                      connection._offSessionEvent(entry.sessionId, entry.eventName, entry.handler);
                    }
                  }
                  expect(connection.eventHandlers.size).toBe(0);
                  break;
                }

                case "addDispatchWaiter": {
                  const sessionId = `sess-${action.sessionIdx}`;
                  if (!connection.getSession(sessionId)) break;
                  const waiterRec = {
                    sessionId,
                    status: "pending" as "pending" | "resolved" | "rejected",
                    promise: Promise.resolve(),
                  };
                  waiterRec.promise = connection
                    .waitForSessionDispatch(sessionId, "Runtime.releaseObject")
                    .then(
                      () => {
                        waiterRec.status = "resolved";
                      },
                      () => {
                        waiterRec.status = "rejected";
                      },
                    );
                  waiters.push(waiterRec);
                  break;
                }

                case "detachEvent": {
                  if (!transport.connected) break;
                  const sessionId = `sess-${action.sessionIdx}`;
                  const siblingPendingBefore = calls.filter(
                    (c) => c.status === "pending" && c.sessionId !== sessionId,
                  );
                  const detachedPendingBefore = calls.filter(
                    (c) => c.status === "pending" && c.sessionId === sessionId,
                  );

                  transport.emitMessage(
                    JSON.stringify({
                      method: "Target.detachedFromTarget",
                      params: { sessionId },
                    }),
                  );
                  await drainQueue(connection);

                  for (const c of detachedPendingBefore) {
                    expect(c.status).toBe("rejected");
                  }
                  for (const c of siblingPendingBefore) {
                    expect(c.status).toBe("pending");
                  }
                  expect(connection.getSession(sessionId)).toBeUndefined();
                  for (const key of connection.eventHandlers.keys()) {
                    expect(key.startsWith(`${sessionId}:`)).toBe(false);
                  }
                  break;
                }

                case "destroyTarget": {
                  if (!transport.connected) break;
                  const targetId = `target-${action.targetIdx}`;
                  const affectedSessions = new Set(
                    [...connection.sessionToTarget.entries()]
                      .filter(([, tid]) => tid === targetId)
                      .map(([sid]) => sid),
                  );
                  const siblingPendingBefore = calls.filter(
                    (c) =>
                      c.status === "pending" &&
                      (c.sessionId === null || !affectedSessions.has(c.sessionId)),
                  );

                  transport.emitMessage(
                    JSON.stringify({
                      method: "Target.targetDestroyed",
                      params: { targetId },
                    }),
                  );
                  await drainQueue(connection);

                  for (const sid of affectedSessions) {
                    expect(connection.getSession(sid)).toBeUndefined();
                  }
                  for (const c of siblingPendingBefore) {
                    expect(c.status).toBe("pending");
                  }
                  break;
                }

                case "sessionClose": {
                  if (!transport.connected) break;
                  const sessionId = `sess-${action.sessionIdx}`;
                  const session = connection.getSession(sessionId);
                  if (!session) break;

                  const siblingPendingBefore = calls.filter(
                    (c) => c.status === "pending" && c.sessionId !== sessionId,
                  );
                  const sessionPendingBefore = calls.filter(
                    (c) => c.status === "pending" && c.sessionId === sessionId,
                  );
                  const detachCallId = connection.nextId;
                  const closePromise = session.close().catch(() => {});

                  if (action.emitDetachedEvent) {
                    transport.emitMessage(
                      JSON.stringify({
                        method: "Target.detachedFromTarget",
                        params: { sessionId },
                      }),
                    );
                  }
                  transport.emitMessage(JSON.stringify({ id: detachCallId, result: {} }));
                  await drainQueue(connection);
                  await closePromise;

                  for (const c of sessionPendingBefore) {
                    expect(c.status).toBe("rejected");
                  }
                  for (const c of siblingPendingBefore) {
                    expect(c.status).toBe("pending");
                  }
                  expect(connection.getSession(sessionId)).toBeUndefined();
                  break;
                }

                case "malformedFrame": {
                  if (!transport.connected) break;
                  const payload =
                    action.variant === "badJson"
                      ? "{invalid-json"
                      : action.variant === "badEnvelope"
                        ? JSON.stringify({ id: "not-a-number", result: {} })
                        : JSON.stringify({ method: "Target.attachedToTarget", params: {} });
                  transport.emitMessage(payload);
                  await drainQueue(connection);
                  expect(connection.inflight.size).toBe(0);
                  expect(connection.sessionDispatchWaiters.size).toBe(0);
                  break;
                }

                case "transportDrop": {
                  if (action.mode === "close") transport.emitClose(1006, "abnormal");
                  else transport.emitError("boom");
                  await drainQueue(connection);
                  expect(connection.inflight.size).toBe(0);
                  expect(connection.sessionDispatchWaiters.size).toBe(0);
                  break;
                }

                default: {
                  const exhaustive: never = action;
                  return exhaustive;
                }
              }
            }

            await connection.close();
            await drainQueue(connection);
            await Promise.all([...calls.map((c) => c.promise), ...waiters.map((w) => w.promise)]);

            for (const entry of listeners.splice(0)) {
              if (entry.sessionId === null) {
                connection.off(entry.eventName, entry.handler);
              } else {
                connection._offSessionEvent(entry.sessionId, entry.eventName, entry.handler);
              }
            }

            expect(siblingFiredUnexpectedly).toStrictEqual([]);
            for (const c of calls) {
              expect(c.settledCount).toBe(1);
            }
            expect(connection.inflight.size).toBe(0);
            expect(connection.sessionDispatchWaiters.size).toBe(0);
            expect(connection.eventHandlers.size).toBe(0);
          },
        ),
        { seed: 20260420, numRuns: 80 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("isolates listener exceptions and prevents infinite loops or same-event re-entry during listener mutations", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const listenerKindArb = fc.constantFrom(
      "record" as const,
      "removeSelf" as const,
      "readdSelf" as const,
      "addSibling" as const,
      "throw" as const,
    );

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.constantFrom("Page.loadEventFired" as const, "Target.targetInfoChanged" as const),
          fc.array(listenerKindArb, { minLength: 1, maxLength: 6 }),
          async (useSession, eventName, kinds) => {
            const transport = new ProgrammableCdpTransport();
            const connection = new CdpConnection(transport, discardLogger);
            const sessionId = "sess-mut";
            if (useSession) {
              transport.emitMessage(
                JSON.stringify({
                  method: "Target.attachedToTarget",
                  params: {
                    sessionId,
                    targetInfo: {
                      targetId: "t-mut",
                      type: "page",
                      title: "",
                      url: "about:blank",
                      attached: true,
                      canAccessOpener: false,
                    },
                    waitingForDebugger: false,
                  },
                }),
              );
              await drainQueue(connection);
            }

            const target = useSession ? connection.getSession(sessionId)! : connection;
            const pendingCall = target.send("Runtime.evaluate", { expression: "1" });
            let pendingSettled = false;
            void pendingCall.then(
              () => {
                pendingSettled = true;
              },
              () => {
                pendingSettled = true;
              },
            );

            let recordCalls = 0;
            let readdGuard = 0;
            let siblingFiredSameDispatch = 0;
            const cleanup: Array<() => void> = [];

            for (const kind of kinds) {
              switch (kind) {
                case "record": {
                  const fn = () => {
                    recordCalls += 1;
                  };
                  target.on(eventName, fn);
                  cleanup.push(() => target.off(eventName, fn));
                  break;
                }
                case "removeSelf": {
                  const fn = () => {
                    target.off(eventName, fn);
                  };
                  target.on(eventName, fn);
                  cleanup.push(() => target.off(eventName, fn));
                  break;
                }
                case "readdSelf": {
                  const fn = () => {
                    readdGuard += 1;
                    if (readdGuard > 20) return;
                    target.off(eventName, fn);
                    target.on(eventName, fn);
                  };
                  target.on(eventName, fn);
                  cleanup.push(() => target.off(eventName, fn));
                  break;
                }
                case "addSibling": {
                  const fn = () => {
                    let inSameDispatch = true;
                    const sibling = () => {
                      if (inSameDispatch) siblingFiredSameDispatch += 1;
                    };
                    target.on(eventName, sibling);
                    cleanup.push(() => target.off(eventName, sibling));
                    queueMicrotask(() => {
                      inSameDispatch = false;
                    });
                  };
                  target.on(eventName, fn);
                  cleanup.push(() => target.off(eventName, fn));
                  break;
                }
                case "throw": {
                  const fn = () => {
                    throw new Error("boom in listener");
                  };
                  target.on(eventName, fn);
                  cleanup.push(() => target.off(eventName, fn));
                  break;
                }
                default: {
                  const exhaustive: never = kind;
                  return exhaustive;
                }
              }
            }

            const expectedRecordCount = kinds.filter((k) => k === "record").length;
            const expectedReaddCount = kinds.filter((k) => k === "readdSelf").length;

            transport.emitMessage(
              JSON.stringify({
                method: eventName,
                params: { ok: true },
                ...(useSession ? { sessionId } : {}),
              }),
            );
            await drainQueue(connection);

            expect(transport.connected).toBe(true);
            expect(pendingSettled).toBe(false);
            expect(recordCalls).toBe(expectedRecordCount);
            expect(readdGuard).toBe(expectedReaddCount);
            expect(siblingFiredSameDispatch).toBe(0);

            const callId = (JSON.parse(transport.sent[0]!) as { id: number }).id;
            transport.emitMessage(JSON.stringify({ id: callId, result: { ok: true } }));
            await drainQueue(connection);
            await expect(pendingCall).resolves.toStrictEqual({ ok: true });

            for (const off of cleanup) off();
            expect(connection.eventHandlers.size).toBe(0);
            await connection.close();
          },
        ),
        { seed: 20260422, numRuns: 60 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("stops processing queued frames after a malformed frame and swallows close() rejections without unhandled rejections", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "{bad",
            '{"id":"str"}',
            '{"method":"Target.attachedToTarget","params":{}}',
          ),
          fc.boolean(),
          async (badFrame, rejectClose) => {
            const transport = new ProgrammableCdpTransport();
            if (rejectClose) {
              transport.close = async () => {
                transport.connected = false;
                throw new Error("socket close failed");
              };
            }
            const connection = new CdpConnection(transport, discardLogger);
            let eventCountAfterBadFrame = 0;
            connection.on("Page.loadEventFired", () => {
              eventCountAfterBadFrame += 1;
            });

            const pending = connection.send("Runtime.evaluate", { expression: "1" });
            const rejected = pending.catch((e: unknown) => e);

            transport.emitMessage(badFrame);
            transport.emitMessage(
              JSON.stringify({ method: "Page.loadEventFired", params: { ts: 1 } }),
            );
            await drainQueue(connection);
            await new Promise((resolve) => setTimeout(resolve, 0));

            const error = await rejected;
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain("socket-message-error");
            expect(eventCountAfterBadFrame).toBe(0);
            expect(connection.inflight.size).toBe(0);
          },
        ),
        { seed: 20260423, numRuns: 20 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("preserves FIFO ordering and Unicode integrity across mixed BrowserWebSocketTransport payload types", async () => {
    const frameArb = fc.record({
      kind: fc.constantFrom(
        "string" as const,
        "arraybuffer" as const,
        "uint8slice" as const,
        "blob" as const,
      ),
      text: fc.oneof(
        fc.string({ maxLength: 30 }),
        fc.constant("héllo 🌎 café"),
        fc.constant('{"id":1,"result":{"v":"✓"}}'),
      ),
      blobDelayTicks: fc.integer({ min: 0, max: 5 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(frameArb, { minLength: 1, maxLength: 15 }),
        fc.boolean(),
        async (frames, appendUnsupported) => {
          ControllableWebSocket.instances = [];
          vi.stubGlobal("WebSocket", ControllableWebSocket);
          try {
            const transport = await browserWebSocketFactory("ws://cdp.prop.test");
            const socket = ControllableWebSocket.instances.at(-1)!;
            const received: string[] = [];
            const errors: Error[] = [];
            transport.onMessage((data) => received.push(data));
            transport.onError((err) => errors.push(err));

            const encoder = new TextEncoder();
            for (const frame of frames) {
              switch (frame.kind) {
                case "string":
                  socket.receive(frame.text);
                  break;
                case "arraybuffer": {
                  const bytes = encoder.encode(frame.text);
                  socket.receive(
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                  );
                  break;
                }
                case "uint8slice": {
                  const bytes = encoder.encode(frame.text);
                  const padded = new Uint8Array(bytes.length + 4);
                  padded.fill(65);
                  padded.set(bytes, 2);
                  socket.receive(padded.subarray(2, 2 + bytes.length));
                  break;
                }
                case "blob":
                  socket.receive(new AsyncDelayBlob([frame.text], frame.blobDelayTicks));
                  break;
                default: {
                  const exhaustive: never = frame.kind;
                  return exhaustive;
                }
              }
            }

            if (appendUnsupported) {
              socket.receive({ unsupported: true });
              socket.receive("must-not-be-delivered-after-decode-error");
            }

            await (transport as unknown as { messageQueue: Promise<void> }).messageQueue;
            for (let i = 0; i < 4; i++) await Promise.resolve();
            expect(received).toStrictEqual(frames.map((f) => f.text));
            if (appendUnsupported) {
              expect(errors.length).toBeGreaterThanOrEqual(1);
              expect(transport.connected).toBe(false);
            }

            await transport.close();
            await transport.close();
            expect(transport.connected).toBe(false);
          } finally {
            vi.unstubAllGlobals();
          }
        },
      ),
      { seed: 20260421, numRuns: 60 },
    );
  });

  it("rejects matching sessionDispatchWaiter when _sendViaSession throws synchronously", async () => {
    const transport = new ProgrammableCdpTransport();
    const connection = new CdpConnection(transport, discardLogger);

    transport.emitMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "sess-sync-throw",
          targetInfo: {
            targetId: "target-sync-throw",
            type: "page",
            title: "",
            url: "about:blank",
            attached: true,
            canAccessOpener: false,
          },
          waitingForDebugger: false,
        },
      }),
    );
    await drainQueue(connection);

    const session = connection.getSession("sess-sync-throw")!;
    const matchingWaiter = connection
      .waitForSessionDispatch("sess-sync-throw", "Runtime.evaluate")
      .catch((error: unknown) => error);
    const nonMatchingWaiter = connection
      .waitForSessionDispatch("sess-sync-throw", "Runtime.releaseObject")
      .catch((error: unknown) => error);

    transport.throwOnNextSend = true;
    await expect(
      Promise.resolve().then(() => session.send("Runtime.evaluate", { expression: "1" })),
    ).rejects.toThrow("transport send failure");
    const matchingError = await matchingWaiter;
    expect(matchingError).toBeInstanceOf(Error);
    expect((matchingError as Error).message).toContain("transport send failure");
    expect(connection.inflight.size).toBe(0);
    expect(connection.sessionDispatchWaiters.size).toBe(1);

    await connection.close();
    expect(await nonMatchingWaiter).toBeInstanceOf(Error);
    expect(connection.sessionDispatchWaiters.size).toBe(0);
  });

  it("suppresses in-flight BrowserWebSocketTransport message and error handlers after close", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("localClose" as const, "remoteClose" as const),
        fc.constantFrom("message" as const, "decodeError" as const),
        async (closeSource, frameOutcome) => {
          ControllableWebSocket.instances = [];
          vi.stubGlobal("WebSocket", ControllableWebSocket);
          try {
            const transport = await browserWebSocketFactory("ws://cdp.prop.test");
            const socket = ControllableWebSocket.instances.at(-1)!;
            const received: string[] = [];
            const errors: Error[] = [];
            transport.onMessage((data) => received.push(data));
            transport.onError((err) => errors.push(err));

            let releaseDecode!: () => void;
            const decodeGate = new Promise<void>((resolve) => {
              releaseDecode = resolve;
            });

            class GatedBlob extends Blob {
              override async text(): Promise<string> {
                await decodeGate;
                if (frameOutcome === "decodeError") {
                  throw new Error("late decode failure");
                }
                return "late-frame";
              }
            }

            socket.receive(new GatedBlob(["late-frame"]));
            await Promise.resolve();

            if (closeSource === "localClose") {
              await transport.close();
            } else {
              socket.close();
            }

            releaseDecode();
            await (transport as unknown as { messageQueue: Promise<void> }).messageQueue;
            for (let i = 0; i < 4; i++) await Promise.resolve();

            expect(received).toStrictEqual([]);
            expect(errors).toStrictEqual([]);
          } finally {
            vi.unstubAllGlobals();
          }
        },
      ),
      { seed: 20260424, numRuns: 20 },
    );
  });
});
