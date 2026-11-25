import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
  JSONRPCErrorCodes,
  type RPCMethod,
} from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import {
  MAX_CALLBACK_BATCH_TIMEOUT_MS,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import type {
  BrowserbaseRequestParams,
  StagehandRpcNotification,
} from "@browserbasehq/stagehand-protocol/types";
import { abortable, abortableDelay, abortReason } from "../src/abort.js";
import { CALLBACK_BATCH_CLIENT_GRACE_MS, StagehandBatchTimeoutError } from "../src/batch.js";
import type { BrowserbaseConnection } from "../src/browserbaseConnection.js";
import { resolveBrowserbaseConnection } from "../src/browserbaseConnection.js";
import { registerBrowserbaseTransport } from "../src/browserbaseRpc.js";
import { executeBrowserbaseRequest } from "../src/browserbaseTransport.js";
import {
  attachStagehandBrowserContext,
  claimStagehandBrowserHandle,
  createStagehandBrowserHandle,
} from "../src/browser/index.js";
import { BrowserContext, Stagehand } from "../src/index.js";
import { RPCClient, rpcResponseTimeoutMs, type CDPTransport } from "../src/rpcClient.js";
import { RPCResponseTimeoutError } from "../src/rpcErrors.js";
import { STAGEHAND_INIT_TIMEOUT_MS, withStagehandInitDeadline } from "../src/timeouts.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RPC_RESPONSE_GRACE_MS = 10_000;

const EchoMethod = {
  name: "test.echo",
  params: z.object({ value: z.string() }).strict(),
  result: z.object({ value: z.string() }).strict(),
} as const satisfies RPCMethod;

type TrackedSignal = {
  controller: AbortController;
  signal: AbortSignal;
  activeListeners: () => number;
};

function instrumentSignal(signal: AbortSignal): () => number {
  const listeners = new Map<EventListenerOrEventListenerObject, number>();
  const listenerMap = new WeakMap<EventListenerOrEventListenerObject, EventListener>();
  const origAdd = signal.addEventListener.bind(signal);
  const origRemove = signal.removeEventListener.bind(signal);

  signal.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "abort" && listener) {
      const wrapped: EventListener = (event) => {
        if (typeof options === "object" && options?.once) {
          const count = listeners.get(listener) ?? 0;
          if (count <= 1) listeners.delete(listener);
          else listeners.set(listener, count - 1);
        }
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      };
      listenerMap.set(listener, wrapped);
      listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
      origAdd(type, wrapped, options);
      return;
    }
    origAdd(type, listener, options);
  };

  signal.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === "abort" && listener) {
      const wrapped = listenerMap.get(listener);
      const count = listeners.get(listener) ?? 0;
      if (count <= 1) listeners.delete(listener);
      else listeners.set(listener, count - 1);
      origRemove(type, wrapped ?? listener, options);
      return;
    }
    origRemove(type, listener, options);
  };

  return () => {
    let total = 0;
    for (const count of listeners.values()) total += count;
    return total;
  };
}

function createTrackedSignal(): TrackedSignal {
  const controller = new AbortController();
  const signal = controller.signal;
  const activeListeners = instrumentSignal(signal);

  return {
    controller,
    signal,
    activeListeners,
  };
}

class ProgrammableCDPTransport implements CDPTransport {
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  readonly sent: JSONRPCMessage[] = [];
  closeCalls = 0;
  nextSendBehavior: "resolve" | "reject" | "sync-throw" = "resolve";

  send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
    const behavior = this.nextSendBehavior;
    this.nextSendBehavior = "resolve";
    switch (behavior) {
      case "resolve":
        return Promise.resolve();
      case "reject":
        return Promise.reject(new Error("transport send failed"));
      case "sync-throw":
        throw new Error("transport send threw synchronously");
      default: {
        const exhaustive: never = behavior;
        return exhaustive;
      }
    }
  }

  async receive(message: unknown): Promise<void> {
    await this.onmessage?.(message);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

type OutboundRecord = {
  id: number;
  kind: "pages" | "count" | "init";
  settledCount: number;
  status: "pending" | "resolved" | "rejected";
  value?: unknown;
  error?: unknown;
  promise: Promise<void>;
  deadlineMs: number | null;
  startedAtMs: number;
  trackedSignal?: TrackedSignal;
};

type RpcAction =
  | {
      type: "send";
      kind: "pages" | "count" | "init";
      useSignal: boolean;
      preAbort: boolean;
      timeoutMode: "default" | "finite" | "zero" | "negative" | "nan" | "infinity" | "large";
      finiteMs: number;
      sendBehavior: "resolve" | "reject" | "sync-throw";
    }
  | { type: "respondSuccess"; targetIdx: number; mode: "pending" | "settled" | "unknown" }
  | {
      type: "respondError";
      targetIdx: number;
      mode: "pending" | "settled" | "unknown";
      isTimeoutError: boolean;
    }
  | { type: "respondMalformed"; targetIdx: number }
  | { type: "respondNullId" }
  | { type: "abortSignal"; targetIdx: number; reasonKind: "error" | "timeout" | "string" }
  | { type: "advanceTime"; deltaMs: number }
  | {
      type: "incomingRequest";
      id: number;
      variant: "ok" | "invalidParams" | "unknownMethod" | "handlerThrows" | "invalidResult";
    }
  | { type: "notification"; seq: number }
  | { type: "toggleNotificationListener" }
  | { type: "disconnect"; mode: "close" | "detach" | "onclose" | "onerror" };

const rpcActionArb: fc.Arbitrary<RpcAction> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant("send" as const),
      kind: fc.constantFrom("pages" as const, "count" as const, "init" as const),
      useSignal: fc.boolean(),
      preAbort: fc.boolean(),
      timeoutMode: fc.constantFrom(
        "default" as const,
        "finite" as const,
        "zero" as const,
        "negative" as const,
        "nan" as const,
        "infinity" as const,
        "large" as const,
      ),
      finiteMs: fc.integer({ min: 1, max: 5_000 }),
      sendBehavior: fc.constantFrom(
        "resolve" as const,
        "resolve" as const,
        "resolve" as const,
        "reject" as const,
        "sync-throw" as const,
      ),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constant("respondSuccess" as const),
      targetIdx: fc.integer({ min: 0, max: 12 }),
      mode: fc.constantFrom(
        "pending" as const,
        "pending" as const,
        "settled" as const,
        "unknown" as const,
      ),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("respondError" as const),
      targetIdx: fc.integer({ min: 0, max: 12 }),
      mode: fc.constantFrom("pending" as const, "settled" as const, "unknown" as const),
      isTimeoutError: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("respondMalformed" as const),
      targetIdx: fc.integer({ min: 0, max: 12 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: "respondNullId" as const }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("abortSignal" as const),
      targetIdx: fc.integer({ min: 0, max: 12 }),
      reasonKind: fc.constantFrom("error" as const, "timeout" as const, "string" as const),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("advanceTime" as const),
      deltaMs: fc.oneof(fc.integer({ min: 1, max: 12_000 }), fc.constant(30_000)),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("incomingRequest" as const),
      id: fc.integer({ min: 1, max: 8 }),
      variant: fc.constantFrom(
        "ok" as const,
        "invalidParams" as const,
        "unknownMethod" as const,
        "handlerThrows" as const,
        "invalidResult" as const,
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant("notification" as const),
      seq: fc.integer({ min: 1, max: 200 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: "toggleNotificationListener" as const }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("disconnect" as const),
      mode: fc.constantFrom(
        "close" as const,
        "detach" as const,
        "onclose" as const,
        "onerror" as const,
      ),
    }),
  },
);

async function flushMicrotasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

function createStagehandForBatch(client: RPCClient): Stagehand {
  const browser = createStagehandBrowserHandle({
    provider: "local",
    origin: "connected",
    attachment: {},
    close: () => {},
  });
  claimStagehandBrowserHandle(browser);
  attachStagehandBrowserContext(browser, new BrowserContext(client, () => browser.close()));
  const stagehand = Object.create(Stagehand.prototype) as Stagehand;
  Object.assign(stagehand, { browserHandle: browser });
  stagehand.rpcClient = client;
  stagehand.isInitialized = true;
  return stagehand;
}

describe("sdk-ts RPCClient, abort, timeout, batch, and Browserbase transport properties", () => {
  afterEach(() => {
    try {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maintains strict settlement, abort-listener, and timer invariants across arbitrary RPCClient interleavings", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(rpcActionArb, { minLength: 1, maxLength: 35 }),
          async (actions) => {
            vi.useFakeTimers();
            const transport = new ProgrammableCDPTransport();
            const client = new RPCClient(transport);
            const records: OutboundRecord[] = [];
            const trackedSignals: TrackedSignal[] = [];
            let unsubscribeNotifications: (() => void) | undefined;
            let handlerMode: "ok" | "throw" | "bad-result" = "ok";

            client.onRequest(EchoMethod, async ({ value }) => {
              if (handlerMode === "throw") throw new Error("handler boom");
              if (handlerMode === "bad-result") return { value: 123 } as never;
              return { value: value.toUpperCase() };
            });

            try {
              for (const action of actions) {
                switch (action.type) {
                  case "send": {
                    const needSignal = action.useSignal || action.kind === "init";
                    const tracked = needSignal ? createTrackedSignal() : undefined;
                    if (tracked) trackedSignals.push(tracked);
                    if (tracked && action.preAbort) {
                      tracked.controller.abort(new Error("pre-aborted"));
                    }

                    let responseTimeoutMs: number | undefined;
                    switch (action.timeoutMode) {
                      case "default":
                        responseTimeoutMs = undefined;
                        break;
                      case "finite":
                        responseTimeoutMs = action.finiteMs;
                        break;
                      case "zero":
                        responseTimeoutMs = 0;
                        break;
                      case "negative":
                        responseTimeoutMs = -action.finiteMs;
                        break;
                      case "nan":
                        responseTimeoutMs = Number.NaN;
                        break;
                      case "infinity":
                        responseTimeoutMs = Number.POSITIVE_INFINITY;
                        break;
                      case "large":
                        responseTimeoutMs = MAX_TIMER_DELAY_MS + 5_000;
                        break;
                      default: {
                        const exhaustive: never = action.timeoutMode;
                        return exhaustive;
                      }
                    }

                    const expectedId = client.nextRequestId;
                    const sentBefore = transport.sent.length;
                    transport.nextSendBehavior = action.sendBehavior;

                    const sendPromise =
                      action.kind === "pages"
                        ? client.send(
                            StagehandMethods.contextPages,
                            {},
                            {
                              ...(tracked ? { signal: tracked.signal } : {}),
                              ...(responseTimeoutMs !== undefined ? { responseTimeoutMs } : {}),
                            },
                          )
                        : action.kind === "count"
                          ? client.send(
                              StagehandMethods.locatorCount,
                              { pageId: "p1", selector: "button" },
                              {
                                ...(tracked ? { signal: tracked.signal } : {}),
                                ...(responseTimeoutMs !== undefined ? { responseTimeoutMs } : {}),
                              },
                            )
                          : client.send(
                              StagehandMethods.stagehandInit,
                              {
                                protocolVersion: STAGEHAND_PROTOCOL_VERSION,
                                clientInfo: { name: "prop-test", version: "1.0.0" },
                                browserCdpUrl: "ws://cdp.test",
                              },
                              {
                                signal: tracked!.signal,
                                ...(responseTimeoutMs !== undefined ? { responseTimeoutMs } : {}),
                              },
                            );
                    transport.nextSendBehavior = "resolve";

                    const record: OutboundRecord = {
                      id: expectedId,
                      kind: action.kind,
                      settledCount: 0,
                      status: "pending",
                      promise: Promise.resolve(),
                      deadlineMs: responseTimeoutMs ?? null,
                      startedAtMs: performance.now(),
                      trackedSignal: tracked,
                    };

                    record.promise = sendPromise.then(
                      (value) => {
                        record.settledCount += 1;
                        record.status = "resolved";
                        record.value = value;
                      },
                      (error: unknown) => {
                        record.settledCount += 1;
                        record.status = "rejected";
                        record.error = error;
                      },
                    );
                    records.push(record);
                    await flushMicrotasks();

                    if (tracked?.signal.aborted && !client.closed) {
                      expect(transport.sent.length).toBe(sentBefore);
                      expect(record.status).toBe("rejected");
                      expect(client.pending.has(expectedId)).toBe(false);
                    }
                    if (action.sendBehavior === "sync-throw" || action.sendBehavior === "reject") {
                      expect(client.pending.has(expectedId)).toBe(false);
                      expect(record.status).toBe("rejected");
                    }
                    break;
                  }

                  case "respondSuccess": {
                    const pool =
                      action.mode === "pending"
                        ? records.filter((r) => r.status === "pending")
                        : action.mode === "settled"
                          ? records.filter((r) => r.status !== "pending")
                          : [];
                    const target =
                      pool.length > 0 ? pool[action.targetIdx % pool.length] : undefined;
                    const id = target ? target.id : 10_000 + action.targetIdx;
                    const result =
                      target?.kind === "count"
                        ? id
                        : target?.kind === "init"
                          ? { initialized: true, pages: [] }
                          : [{ page_id: `p-${id}`, url: `https://example.test/${id}` }];
                    await transport.receive({ jsonrpc: "2.0", id, result });
                    await flushMicrotasks();
                    break;
                  }

                  case "respondError": {
                    const pool =
                      action.mode === "pending"
                        ? records.filter((r) => r.status === "pending")
                        : action.mode === "settled"
                          ? records.filter((r) => r.status !== "pending")
                          : [];
                    const target =
                      pool.length > 0 ? pool[action.targetIdx % pool.length] : undefined;
                    const id = target ? target.id : 20_000 + action.targetIdx;
                    await transport.receive({
                      jsonrpc: "2.0",
                      id,
                      error: {
                        code: JSONRPCErrorCodes.internalError,
                        message: `error-${id}`,
                        ...(action.isTimeoutError ? { data: { name: "TimeoutError" } } : {}),
                      },
                    });
                    await flushMicrotasks();
                    if (
                      target &&
                      !client.closed &&
                      action.mode === "pending" &&
                      action.isTimeoutError
                    ) {
                      expect(target.status).toBe("rejected");
                      expect((target.error as Error).name).toBe("TimeoutError");
                    }
                    break;
                  }

                  case "respondMalformed": {
                    const pending = records.filter((r) => r.status === "pending");
                    if (pending.length === 0) break;
                    const target = pending[action.targetIdx % pending.length]!;
                    await transport.receive({
                      jsonrpc: "2.0",
                      id: target.id,
                      result: { invalid_shape: true },
                    });
                    await flushMicrotasks();
                    expect(target.status).toBe("rejected");
                    expect(client.pending.has(target.id)).toBe(false);
                    break;
                  }

                  case "respondNullId": {
                    await transport.receive({
                      jsonrpc: "2.0",
                      id: null,
                      error: { code: JSONRPCErrorCodes.parseError, message: "parse" },
                    });
                    await flushMicrotasks();
                    break;
                  }

                  case "abortSignal": {
                    if (trackedSignals.length === 0) break;
                    const target = trackedSignals[action.targetIdx % trackedSignals.length]!;
                    const reason =
                      action.reasonKind === "error"
                        ? new Error("manual abort")
                        : action.reasonKind === "timeout"
                          ? new DOMException("manual timeout", "TimeoutError")
                          : "primitive-abort-reason";
                    target.controller.abort(reason);
                    await flushMicrotasks();
                    break;
                  }

                  case "advanceTime": {
                    await vi.advanceTimersByTimeAsync(action.deltaMs);
                    await flushMicrotasks();
                    break;
                  }

                  case "incomingRequest": {
                    const previousMode = handlerMode;
                    if (action.variant === "handlerThrows") handlerMode = "throw";
                    else if (action.variant === "invalidResult") handlerMode = "bad-result";
                    else handlerMode = "ok";

                    const message =
                      action.variant === "unknownMethod"
                        ? { jsonrpc: "2.0", id: action.id, method: "unknown.method", params: {} }
                        : action.variant === "invalidParams"
                          ? {
                              jsonrpc: "2.0",
                              id: action.id,
                              method: EchoMethod.name,
                              params: { value: 99 },
                            }
                          : {
                              jsonrpc: "2.0",
                              id: action.id,
                              method: EchoMethod.name,
                              params: { value: "hi" },
                            };
                    await transport.receive(message);
                    handlerMode = previousMode;
                    await flushMicrotasks();
                    break;
                  }

                  case "notification": {
                    const notification: StagehandRpcNotification = {
                      jsonrpc: "2.0",
                      method: StagehandNotifications.browserbaseCancel.name,
                      params: { requestId: action.seq, reason: "cancelled" },
                    };
                    await transport.receive({
                      jsonrpc: "2.0",
                      method: notification.method,
                      params: { request_id: action.seq, reason: "cancelled" },
                    });
                    expect(client.pendingNotifications.length).toBeLessThanOrEqual(100);
                    break;
                  }

                  case "toggleNotificationListener": {
                    if (unsubscribeNotifications) {
                      unsubscribeNotifications();
                      unsubscribeNotifications = undefined;
                    } else {
                      unsubscribeNotifications = client.onNotification(() => {});
                    }
                    break;
                  }

                  case "disconnect": {
                    const { mode } = action;
                    const reason = new Error(`disconnect-${mode}`);
                    switch (mode) {
                      case "close":
                        client.close(reason);
                        break;
                      case "detach":
                        client.close(reason, { closeTransport: false });
                        break;
                      case "onclose":
                        transport.onclose?.(reason);
                        break;
                      case "onerror":
                        transport.onerror?.(reason);
                        break;
                      default: {
                        const exhaustive: never = mode;
                        return exhaustive;
                      }
                    }
                    await flushMicrotasks();
                    expect(client.closed).toBe(true);
                    expect(client.pending.size).toBe(0);
                    break;
                  }

                  default: {
                    const exhaustive: never = action;
                    return exhaustive;
                  }
                }
              }

              client.close(new Error("end of run"));
              await Promise.all(records.map((r) => r.promise));
              await flushMicrotasks();

              for (const record of records) {
                expect(record.settledCount).toBe(1);
              }
              expect(client.pending.size).toBe(0);
              expect(vi.getTimerCount()).toBe(0);
              for (const tracked of trackedSignals) {
                expect(tracked.activeListeners()).toBe(0);
              }
            } finally {
              client.close();
              vi.useRealTimers();
            }
          },
        ),
        { seed: 20260401, numRuns: 80 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("enforces abort.ts zero-leak teardown, nested signal composition, and timer-clamping invariants", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            outcome: fc.constantFrom("resolve" as const, "reject" as const, "never" as const),
            abortTiming: fc.constantFrom(
              "never" as const,
              "pre" as const,
              "mid" as const,
              "post" as const,
            ),
            reasonKind: fc.constantFrom("error" as const, "string" as const, "undefined" as const),
            parentCount: fc.integer({ min: 1, max: 3 }),
            abortParentIdx: fc.integer({ min: 0, max: 2 }),
          }),
          async ({ outcome, abortTiming, reasonKind, parentCount, abortParentIdx }) => {
            const parents = Array.from({ length: parentCount }, () => createTrackedSignal());
            const composed =
              parents.length === 1
                ? parents[0]!.signal
                : AbortSignal.any(parents.map((p) => p.signal));
            const composedActiveListeners =
              parents.length === 1 ? parents[0]!.activeListeners : instrumentSignal(composed);
            const targetParent = parents[abortParentIdx % parents.length]!;
            const triggerAbort = () => {
              if (reasonKind === "error") targetParent.controller.abort(new Error("abort-err"));
              else if (reasonKind === "string") targetParent.controller.abort("non-error");
              else targetParent.controller.abort();
            };

            let resolveInner!: (v: string) => void;
            let rejectInner!: (e: Error) => void;
            const inner = new Promise<string>((resolve, reject) => {
              resolveInner = resolve;
              rejectInner = reject;
            });

            if (abortTiming === "pre") triggerAbort();

            const wrapped = abortable(inner, composed);
            let settledOutcome: "resolved" | "rejected" | undefined;
            let caught: unknown;
            const done = wrapped.then(
              () => {
                settledOutcome = "resolved";
              },
              (error: unknown) => {
                settledOutcome = "rejected";
                caught = error;
              },
            );

            if (abortTiming === "mid") triggerAbort();

            if (outcome === "resolve") resolveInner("ok");
            else if (outcome === "reject") rejectInner(new Error("inner-fail"));
            else if (abortTiming === "never" || abortTiming === "post") {
              resolveInner("fallback");
            }

            await done;
            if (abortTiming === "post") triggerAbort();
            await flushMicrotasks();

            if (abortTiming === "pre" || abortTiming === "mid") {
              expect(settledOutcome).toBe("rejected");
              expect(caught).toBeInstanceOf(Error);
              if (composed.reason instanceof Error) {
                expect(caught).toBe(composed.reason);
              } else {
                expect((caught as Error).message).toBe(abortReason(composed).message);
              }
            } else if (outcome === "reject") {
              expect(settledOutcome).toBe("rejected");
              expect((caught as Error).message).toBe("inner-fail");
            } else {
              expect(settledOutcome).toBe("resolved");
            }

            for (const parent of parents) {
              expect(parent.activeListeners()).toBe(0);
            }
            expect(composedActiveListeners()).toBe(0);
          },
        ),
        { seed: 20260402, numRuns: 80 },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            delayMs: fc.oneof(
              fc.constant(0),
              fc.constant(-100),
              fc.constant(Number.NaN),
              fc.constant(Number.POSITIVE_INFINITY),
              fc.constant(MAX_TIMER_DELAY_MS + 10_000),
              fc.integer({ min: 1, max: 5_000 }),
            ),
            useSignal: fc.boolean(),
            abortAtMs: fc.option(fc.integer({ min: 0, max: 2_500 }), { nil: undefined }),
          }),
          async ({ delayMs, useSignal, abortAtMs }) => {
            vi.useFakeTimers();
            const tracked = useSignal ? createTrackedSignal() : undefined;
            try {
              if (tracked && abortAtMs === 0) {
                tracked.controller.abort(new Error("pre-abort-delay"));
              }

              if (!useSignal && delayMs === Number.POSITIVE_INFINITY) {
                return;
              }

              const pending = abortableDelay(delayMs, tracked?.signal);
              let status: "pending" | "resolved" | "rejected" = "pending";
              const done = pending.then(
                () => {
                  status = "resolved";
                },
                () => {
                  status = "rejected";
                },
              );

              if (tracked && abortAtMs !== undefined && abortAtMs > 0) {
                await vi.advanceTimersByTimeAsync(abortAtMs);
                if (status === "pending") {
                  tracked.controller.abort(new Error("mid-abort-delay"));
                }
              }

              if (delayMs === Number.POSITIVE_INFINITY && tracked) {
                await vi.advanceTimersByTimeAsync(10_000);
                expect(status).toBe(abortAtMs !== undefined ? "rejected" : "pending");
                if (status === "pending") {
                  tracked.controller.abort(new Error("stop-infinity"));
                }
              } else if (delayMs > MAX_TIMER_DELAY_MS) {
                await vi.advanceTimersByTimeAsync(100);
                if (!tracked || abortAtMs === undefined) {
                  expect(status).toBe("pending");
                }
                if (status === "pending") {
                  await vi.advanceTimersByTimeAsync(delayMs);
                }
              } else {
                await vi.advanceTimersByTimeAsync(
                  Math.max(0, Number.isFinite(delayMs) ? delayMs : 0) + 10,
                );
              }

              await done;
              await flushMicrotasks();

              expect(vi.getTimerCount()).toBe(0);
              if (tracked) {
                expect(tracked.activeListeners()).toBe(0);
              }
            } finally {
              vi.useRealTimers();
            }
          },
        ),
        { seed: 20260403, numRuns: 80 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("enforces timeouts.ts and rpcResponseTimeoutMs clamping across all StagehandMethods and edge inputs", async () => {
    const allMethods = Object.values(StagehandMethods).map((m) => m.name);

    fc.assert(
      fc.property(
        fc.constantFrom(...allMethods),
        fc.oneof(
          fc.constant(undefined),
          fc.constant(0),
          fc.constant(-1),
          fc.constant(-50_000),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.integer({ min: 1, max: 120_000 }),
          fc.constant(MAX_TIMER_DELAY_MS + 1),
        ),
        (method, rawTimeout) => {
          const params =
            method === StagehandMethods.pageWaitForLoadState.name
              ? { timeout: rawTimeout }
              : method === StagehandMethods.pageWaitForTimeout.name
                ? { ms: rawTimeout }
                : { options: rawTimeout === undefined ? {} : { timeout: rawTimeout } };
          const computed = rpcResponseTimeoutMs(method, params);
          if (computed !== undefined) {
            expect(Number.isFinite(computed)).toBe(true);
            expect(computed).toBeGreaterThanOrEqual(RPC_RESPONSE_GRACE_MS);
          }
        },
      ),
      { seed: 20260404, numRuns: 300 },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          behavior: fc.constantFrom(
            "resolve" as const,
            "reject" as const,
            "sync-throw" as const,
            "hang" as const,
          ),
          delayMs: fc.integer({ min: 0, max: STAGEHAND_INIT_TIMEOUT_MS + 5_000 }),
        }),
        async ({ behavior, delayMs }) => {
          vi.useFakeTimers();
          try {
            let receivedSignal: AbortSignal | undefined;
            const run = withStagehandInitDeadline(async (signal) => {
              receivedSignal = signal;
              if (behavior === "sync-throw") throw new Error("sync-init-failure");
              if (behavior === "hang") return await new Promise<string>(() => {});
              await abortableDelay(delayMs, signal);
              if (behavior === "reject") throw new Error("async-init-failure");
              return "initialized";
            });

            let outcome: "resolved" | "rejected" = "resolved";
            let error: unknown;
            const done = run.then(
              () => {
                outcome = "resolved";
              },
              (err: unknown) => {
                outcome = "rejected";
                error = err;
              },
            );

            await vi.advanceTimersByTimeAsync(STAGEHAND_INIT_TIMEOUT_MS + 10_000);
            await done;
            await flushMicrotasks();

            expect(vi.getTimerCount()).toBe(0);
            if (behavior === "sync-throw") {
              expect(outcome).toBe("rejected");
              expect(receivedSignal?.aborted).toBe(false);
            } else if (behavior === "hang" || delayMs >= STAGEHAND_INIT_TIMEOUT_MS) {
              expect(outcome).toBe("rejected");
              if (behavior === "hang" || delayMs > STAGEHAND_INIT_TIMEOUT_MS) {
                expect(receivedSignal?.aborted).toBe(true);
                expect((error as Error).message).toContain(`${STAGEHAND_INIT_TIMEOUT_MS}ms`);
              }
            } else if (behavior === "resolve") {
              expect(outcome).toBe("resolved");
              expect(receivedSignal?.aborted).toBe(false);
            } else {
              expect(outcome).toBe("rejected");
            }
          } finally {
            vi.useRealTimers();
          }
        },
      ),
      { seed: 20260405, numRuns: 60 },
    );
  });

  it("verifies concurrent batch execution, output correlation, deadline clamping, and partial-failure isolation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            timeout: fc.integer({ min: 100, max: 5_000 }),
            responseDelayMs: fc.integer({ min: 0, max: 25_000 }),
            outcome: fc.constantFrom("ok" as const, "rpc-error" as const, "stall" as const),
            payload: fc.oneof(fc.string({ maxLength: 20 }), fc.integer({ min: -100, max: 100 })),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (specs) => {
          vi.useFakeTimers();
          const transport = new ProgrammableCDPTransport();
          const client = new RPCClient(transport);
          const stagehand = createStagehandForBatch(client);

          try {
            const scheduled: Array<{
              id: number;
              spec: (typeof specs)[number];
              promise: Promise<{ kind: "ok"; value: unknown } | { kind: "err"; error: unknown }>;
            }> = [];

            for (const spec of specs) {
              const id = client.nextRequestId;
              const p = stagehand
                .experimentalBatch(async () => null, spec.payload, { timeout: spec.timeout })
                .then(
                  (value) => ({ kind: "ok" as const, value }),
                  (error: unknown) => ({ kind: "err" as const, error }),
                );
              scheduled.push({ id, spec, promise: p });
            }

            const events = scheduled
              .filter((item) => item.spec.outcome !== "stall")
              .toSorted((a, b) => a.spec.responseDelayMs - b.spec.responseDelayMs);

            let elapsed = 0;
            for (const item of events) {
              const step = item.spec.responseDelayMs - elapsed;
              if (step > 0) {
                await vi.advanceTimersByTimeAsync(step);
                elapsed += step;
              }
              if (item.spec.outcome === "ok") {
                await transport.receive({
                  jsonrpc: "2.0",
                  id: item.id,
                  result: { value: item.spec.payload },
                });
              } else {
                await transport.receive({
                  jsonrpc: "2.0",
                  id: item.id,
                  error: {
                    code: JSONRPCErrorCodes.internalError,
                    message: `batch-fail-${item.id}`,
                  },
                });
              }
            }

            await vi.advanceTimersByTimeAsync(30_000);
            const results = await Promise.all(scheduled.map((item) => item.promise));

            for (let i = 0; i < scheduled.length; i++) {
              const item = scheduled[i]!;
              const res = results[i]!;
              const clientTimeout = Math.min(
                item.spec.timeout + CALLBACK_BATCH_CLIENT_GRACE_MS,
                MAX_TIMER_DELAY_MS,
              );
              const timedOutFirst =
                item.spec.outcome === "stall" || item.spec.responseDelayMs >= clientTimeout;

              if (timedOutFirst) {
                expect(res.kind).toBe("err");
                if (res.kind === "err") {
                  expect(res.error).toBeInstanceOf(StagehandBatchTimeoutError);
                  const batchErr = res.error as StagehandBatchTimeoutError;
                  expect(batchErr.timeout).toBe(item.spec.timeout);
                  expect(batchErr.clientTimeout).toBe(clientTimeout);
                  expect(batchErr.cause).toBeInstanceOf(RPCResponseTimeoutError);
                }
              } else if (item.spec.outcome === "ok") {
                expect(res).toStrictEqual({ kind: "ok", value: item.spec.payload });
              } else {
                expect(res.kind).toBe("err");
                if (res.kind === "err") {
                  expect(res.error).not.toBeInstanceOf(StagehandBatchTimeoutError);
                  expect((res.error as Error).message).toBe(`batch-fail-${item.id}`);
                }
              }
            }

            expect(client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            client.close();
            vi.useRealTimers();
          }
        },
      ),
      { seed: 20260406, numRuns: 50 },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(0),
          fc.integer({ min: -10_000, max: -1 }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(1.5),
          fc.constant(MAX_CALLBACK_BATCH_TIMEOUT_MS + 1),
        ),
        async (badTimeout) => {
          const client = new RPCClient(new ProgrammableCDPTransport());
          const stagehand = createStagehandForBatch(client);
          try {
            await expect(
              stagehand.experimentalBatch(async () => 1, undefined, { timeout: badTimeout }),
            ).rejects.toBeInstanceOf(RangeError);
          } finally {
            client.close();
          }
        },
      ),
      { seed: 20260407, numRuns: 30 },
    );
  });

  it("isolates concurrent Browserbase reverse RPCs across cancellations, timeouts, dispose, and close with zero timer leaks", async () => {
    type BbAction =
      | {
          type: "request";
          id: number;
          operation: BrowserbaseRequestParams["operation"];
          remainingTimeoutMs: number | undefined;
        }
      | { type: "cancel"; id: number; reason: "cancelled" | "timeout" }
      | { type: "completeFetch"; idx: number; kind: "ok" | "network-error" }
      | { type: "advanceTime"; deltaMs: number }
      | { type: "dispose" }
      | { type: "closeClient" };

    const bbActionArb: fc.Arbitrary<BbAction> = fc.oneof(
      {
        weight: 5,
        arbitrary: fc.record({
          type: fc.constant("request" as const),
          id: fc.integer({ min: 1, max: 6 }),
          operation: fc.constantFrom(
            "gateway.responses" as const,
            "cache.get" as const,
            "cache.set" as const,
          ),
          remainingTimeoutMs: fc.oneof(
            fc.constant(undefined),
            fc.constant(0),
            fc.integer({ min: 50, max: 2_000 }),
            fc.constant(MAX_TIMER_DELAY_MS + 100),
          ),
        }),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          type: fc.constant("cancel" as const),
          id: fc.integer({ min: 1, max: 6 }),
          reason: fc.constantFrom("cancelled" as const, "timeout" as const),
        }),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          type: fc.constant("completeFetch" as const),
          idx: fc.integer({ min: 0, max: 10 }),
          kind: fc.constantFrom("ok" as const, "network-error" as const),
        }),
      },
      {
        weight: 3,
        arbitrary: fc.record({
          type: fc.constant("advanceTime" as const),
          deltaMs: fc.integer({ min: 50, max: 1_500 }),
        }),
      },
      { weight: 1, arbitrary: fc.constant({ type: "dispose" as const }) },
      { weight: 1, arbitrary: fc.constant({ type: "closeClient" as const }) },
    );

    const connection: BrowserbaseConnection = {
      apiKey: "bb_live_secret_key",
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      sessionId: "sess-prop-1",
    };

    await fc.assert(
      fc.asyncProperty(fc.array(bbActionArb, { minLength: 1, maxLength: 25 }), async (actions) => {
        vi.useFakeTimers();
        const transport = new ProgrammableCDPTransport();
        const client = new RPCClient(transport);
        const dispose = registerBrowserbaseTransport(client, connection);

        type InflightFetch = {
          request: Request;
          signal: AbortSignal | undefined;
          resolve: (res: Response) => void;
          reject: (err: Error) => void;
          settled: boolean;
        };
        const fetches: InflightFetch[] = [];

        vi.stubGlobal(
          "fetch",
          vi.fn((request: Request, init?: RequestInit) => {
            return new Promise<Response>((resolve, reject) => {
              const entry: InflightFetch = {
                request,
                signal: init?.signal ?? undefined,
                resolve: (res) => {
                  entry.settled = true;
                  resolve(res);
                },
                reject: (err) => {
                  entry.settled = true;
                  reject(err);
                },
                settled: false,
              };
              fetches.push(entry);
              init?.signal?.addEventListener(
                "abort",
                () => {
                  if (!entry.settled) entry.reject(new Error("aborted"));
                },
                { once: true },
              );
            });
          }),
        );

        const incomingPromises: Promise<void>[] = [];
        try {
          for (const action of actions) {
            switch (action.type) {
              case "request": {
                incomingPromises.push(
                  transport.receive({
                    jsonrpc: "2.0",
                    id: action.id,
                    method: StagehandMethods.browserbaseRequest.name,
                    params: {
                      operation: action.operation,
                      headers: {
                        "x-bb-api-key": "spoofed",
                        "x-forwarded-for": "1.2.3.4",
                        "x-custom": "keep",
                      },
                      body: "{}",
                      ...(action.remainingTimeoutMs === undefined
                        ? {}
                        : { remaining_timeout_ms: action.remainingTimeoutMs }),
                    },
                  }),
                );
                await flushMicrotasks();
                break;
              }
              case "cancel": {
                await transport.receive({
                  jsonrpc: "2.0",
                  method: StagehandNotifications.browserbaseCancel.name,
                  params: { request_id: action.id, reason: action.reason },
                });
                await flushMicrotasks();
                break;
              }
              case "completeFetch": {
                const active = fetches.filter((f) => !f.settled);
                if (active.length === 0) break;
                const entry = active[action.idx % active.length]!;
                expect(entry.request.headers.get("x-bb-api-key")).toBe(connection.apiKey);
                expect(entry.request.headers.get("x-forwarded-for")).toBeNull();
                expect(entry.request.headers.get("x-custom")).toBe("keep");
                if (action.kind === "ok") {
                  entry.resolve(
                    new Response('{"ok":true}', {
                      status: 200,
                      headers: {
                        "content-encoding": "gzip",
                        "content-length": "11",
                        "x-resp": "yes",
                      },
                    }),
                  );
                } else {
                  entry.reject(new TypeError("socket reset"));
                }
                await flushMicrotasks();
                break;
              }
              case "advanceTime": {
                await vi.advanceTimersByTimeAsync(action.deltaMs);
                await flushMicrotasks();
                break;
              }
              case "dispose": {
                dispose();
                await flushMicrotasks();
                break;
              }
              case "closeClient": {
                const sentBeforeClose = transport.sent.length;
                client.close(new Error("closed-in-test"));
                await flushMicrotasks();
                for (const entry of fetches) {
                  if (!entry.settled) entry.resolve(new Response("{}"));
                }
                await flushMicrotasks();
                expect(transport.sent.length).toBe(sentBeforeClose);
                break;
              }
              default: {
                const exhaustive: never = action;
                return exhaustive;
              }
            }
          }

          dispose();
          for (const entry of fetches) {
            if (!entry.settled) entry.reject(new Error("cleanup"));
          }
          await Promise.all(incomingPromises);
          await flushMicrotasks();
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          dispose();
          client.close();
          vi.unstubAllGlobals();
          vi.useRealTimers();
        }
      }),
      { seed: 20260408, numRuns: 50 },
    );
  });

  it("normalizes and freezes resolveBrowserbaseConnection across regions, trailing slashes, and missing fields", () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        fc.option(
          fc.constantFrom(
            "us-west-2" as const,
            "us-east-1" as const,
            "eu-central-1" as const,
            "ap-southeast-1" as const,
          ),
          { nil: undefined },
        ),
        fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }),
        (apiKey, sessionId, region, trailingSlashes) => {
          const apiUrl =
            trailingSlashes === undefined
              ? undefined
              : `https://custom.browserbase.test${"/".repeat(trailingSlashes)}`;
          const resolved = resolveBrowserbaseConnection(
            { ...(apiKey ? { apiKey } : {}), ...(apiUrl ? { apiUrl } : {}) },
            sessionId ? { browser: { sessionId, ...(region ? { region } : {}) } } : {},
          );
          if (!apiKey || !sessionId) {
            expect(resolved).toBeUndefined();
            return;
          }
          expect(resolved).toBeDefined();
          expect(Object.isFrozen(resolved)).toBe(true);
          expect(resolved!.apiKey).toBe(apiKey);
          expect(resolved!.sessionId).toBe(sessionId);
          expect(resolved!.apiUrl.endsWith("/v1")).toBe(true);
          expect(resolved!.apiUrl.endsWith("//v1")).toBe(false);
        },
      ),
      { seed: 20260412, numRuns: 100 },
    );
  });

  it("never leaks timers in executeBrowserbaseRequest across arbitrary timeout budgets and abort timings", async () => {
    const connection: BrowserbaseConnection = {
      apiKey: "bb_live_key",
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      sessionId: "sess-1",
    };

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          remainingTimeoutMs: fc.oneof(
            fc.constant(undefined),
            fc.constant(0),
            fc.integer({ min: 1, max: 3_000 }),
            fc.constant(MAX_TIMER_DELAY_MS + 10),
          ),
          abortReasonKind: fc.constantFrom("none" as const, "abort" as const, "timeout" as const),
          fetchOutcome: fc.constantFrom("ok" as const, "network" as const, "hang" as const),
        }),
        async ({ remainingTimeoutMs, abortReasonKind, fetchOutcome }) => {
          vi.useFakeTimers();
          const tracked = abortReasonKind === "none" ? undefined : createTrackedSignal();
          vi.stubGlobal(
            "fetch",
            vi.fn((_req: Request, init?: RequestInit) => {
              if (fetchOutcome === "ok")
                return Promise.resolve(new Response("ok", { status: 200 }));
              if (fetchOutcome === "network") return Promise.reject(new TypeError("net err"));
              return new Promise<Response>((_res, rej) => {
                init?.signal?.addEventListener("abort", () => rej(init.signal?.reason), {
                  once: true,
                });
              });
            }),
          );
          try {
            const pending = executeBrowserbaseRequest(
              connection,
              {
                operation: "cache.get",
                headers: {},
                body: "{}",
                ...(remainingTimeoutMs === undefined ? {} : { remainingTimeoutMs }),
              },
              tracked?.signal,
            );
            if (tracked) {
              tracked.controller.abort(
                abortReasonKind === "timeout"
                  ? new DOMException("timed out", "TimeoutError")
                  : new Error("cancelled"),
              );
            } else if (fetchOutcome === "hang" && remainingTimeoutMs !== undefined) {
              if (remainingTimeoutMs > MAX_TIMER_DELAY_MS) {
                const res = await Promise.race([
                  pending.then(() => "settled"),
                  vi.advanceTimersByTimeAsync(100).then(() => "pending"),
                ]);
                expect(res).toBe("pending");
                await vi.advanceTimersByTimeAsync(remainingTimeoutMs);
              } else {
                await vi.advanceTimersByTimeAsync(remainingTimeoutMs + 10);
              }
            } else if (fetchOutcome === "hang") {
              return;
            }
            const result = await pending;
            expect(["response", "error"]).toContain(result.type);
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
          }
        },
      ),
      { seed: 20260409, numRuns: 60 },
    );
  });
});
