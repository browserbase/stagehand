import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { encodeWireValue } from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { JSONRPCErrorCodes } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  BrowserbaseHttpResponse,
  BrowserbaseRequestParams,
  BrowserbaseTransportError,
} from "@browserbasehq/stagehand-protocol/types";
import { requestBrowserbase } from "./browserbaseClient.js";
import { ChromeRuntimeClient } from "./chromeRuntimeClient.js";
import { RPCClient } from "./rpcClient.js";
import { RPCRouter } from "../rpcRouter.js";
import { createStagehandRuntime } from "../runtime.js";

type TrackedSignal = {
  controller: AbortController;
  signal: AbortSignal;
  activeListeners: () => number;
};

function createTrackedSignal(): TrackedSignal {
  const controller = new AbortController();
  const signal = controller.signal;
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
    options?: boolean | AddEventListenerOptions,
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

  return {
    controller,
    signal,
    activeListeners: () => {
      let total = 0;
      for (const count of listeners.values()) total += count;
      return total;
    },
  };
}

function createTestRuntime() {
  return createStagehandRuntime(
    {
      browserSessionFactory: async () => {
        throw new Error("no browser session in property test");
      },
    },
    {
      tracer: trace.getTracer("extension-rpc-prop-test"),
      configure: async () => {},
      forceFlush: async () => {},
      shutdown: async () => {},
    },
  );
}

async function flushMicrotasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

type ExtAction =
  | {
      type: "send";
      useSignal: boolean;
      preAbort: boolean;
      abortDuringBinding: boolean;
      onAbortMode: "notify" | "throw" | "reject" | "hang" | "none";
      dispatchMode: "immediate" | "deferred" | "reject" | "sync-throw";
    }
  | { type: "resolveDispatch"; idx: number; ok: boolean }
  | {
      type: "respond";
      targetIdx: number;
      pool: "pending" | "settled" | "unknown";
      kind: "ok" | "error" | "malformed-result" | "null-id";
    }
  | { type: "abort"; targetIdx: number; reasonKind: "error" | "timeout" | "string" }
  | { type: "notify" }
  | { type: "releaseClient" }
  | { type: "acceptClient" }
  | {
      type: "incoming";
      id: number;
      variant: "metrics" | "unknown-method" | "invalid-json" | "notification";
    }
  | { type: "dropTransport"; mode: "close" | "onclose" | "onerror" };

const extActionArb: fc.Arbitrary<ExtAction> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant("send" as const),
      useSignal: fc.boolean(),
      preAbort: fc.boolean(),
      abortDuringBinding: fc.boolean(),
      onAbortMode: fc.constantFrom(
        "notify" as const,
        "throw" as const,
        "reject" as const,
        "hang" as const,
        "none" as const,
      ),
      dispatchMode: fc.constantFrom(
        "immediate" as const,
        "immediate" as const,
        "deferred" as const,
        "reject" as const,
        "sync-throw" as const,
      ),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("resolveDispatch" as const),
      idx: fc.integer({ min: 0, max: 10 }),
      ok: fc.boolean(),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constant("respond" as const),
      targetIdx: fc.integer({ min: 0, max: 10 }),
      pool: fc.constantFrom(
        "pending" as const,
        "pending" as const,
        "settled" as const,
        "unknown" as const,
      ),
      kind: fc.constantFrom(
        "ok" as const,
        "ok" as const,
        "error" as const,
        "malformed-result" as const,
        "null-id" as const,
      ),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("abort" as const),
      targetIdx: fc.integer({ min: 0, max: 10 }),
      reasonKind: fc.constantFrom("error" as const, "timeout" as const, "string" as const),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: "notify" as const }) },
  { weight: 2, arbitrary: fc.constant({ type: "releaseClient" as const }) },
  { weight: 2, arbitrary: fc.constant({ type: "acceptClient" as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("incoming" as const),
      id: fc.integer({ min: 1, max: 6 }),
      variant: fc.constantFrom(
        "metrics" as const,
        "unknown-method" as const,
        "invalid-json" as const,
        "notification" as const,
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("dropTransport" as const),
      mode: fc.constantFrom("close" as const, "onclose" as const, "onerror" as const),
    }),
  },
);

describe("extension RPCClient and Browserbase client properties", () => {
  afterEach(() => {
    try {
      vi.restoreAllMocks();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maintains settlement, notifyAbort swallowing, releaseClient/acceptClient, and zero-leak invariants", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(extActionArb, { minLength: 1, maxLength: 30 }),
          async (actions) => {
            vi.useFakeTimers();
            const sentMessages: Array<Record<string, unknown>> = [];
            let bindingSideEffect: (() => void) | undefined;

            const runtimeClient = new ChromeRuntimeClient(
              {
                sendToHost(payload: string): void {
                  sentMessages.push(JSON.parse(payload) as Record<string, unknown>);
                  const effect = bindingSideEffect;
                  bindingSideEffect = undefined;
                  effect?.();
                },
              },
              "sendToHost",
            );

            const baseSend = runtimeClient.send.bind(runtimeClient);
            const deferredDispatches: Array<{
              resolve: () => void;
              reject: (err: Error) => void;
              settled: boolean;
            }> = [];
            let nextDispatchMode: "immediate" | "deferred" | "reject" | "sync-throw" = "immediate";

            runtimeClient.send = (message) => {
              const mode = nextDispatchMode;
              nextDispatchMode = "immediate";
              switch (mode) {
                case "immediate":
                  return baseSend(message);
                case "deferred":
                  return new Promise<void>((resolve, reject) => {
                    const gate = {
                      settled: false,
                      resolve: () => {
                        if (gate.settled) return;
                        gate.settled = true;
                        void baseSend(message).then(resolve, reject);
                      },
                      reject: (err: Error) => {
                        if (gate.settled) return;
                        gate.settled = true;
                        reject(err);
                      },
                    };
                    deferredDispatches.push(gate);
                  });
                case "reject":
                  return Promise.reject(new Error("runtime send rejected"));
                case "sync-throw":
                  throw new Error("runtime send threw synchronously");
                default: {
                  const exhaustive: never = mode;
                  return exhaustive;
                }
              }
            };

            const client = new RPCClient(runtimeClient, new RPCRouter(createTestRuntime()));

            type SendRec = {
              id: number;
              settledCount: number;
              status: "pending" | "resolved" | "rejected";
              promise: Promise<void>;
              onAbortCalls: number;
              preAborted: boolean;
              dispatchFailed: boolean;
            };

            const records: SendRec[] = [];
            const trackedSignals: TrackedSignal[] = [];

            try {
              for (const action of actions) {
                switch (action.type) {
                  case "send": {
                    const tracked = action.useSignal ? createTrackedSignal() : undefined;
                    if (tracked) trackedSignals.push(tracked);
                    if (tracked && action.preAbort) {
                      tracked.controller.abort(new Error("pre-abort"));
                    }

                    const id = client.nextRequestId;
                    const rec: SendRec = {
                      id,
                      settledCount: 0,
                      status: "pending",
                      promise: Promise.resolve(),
                      onAbortCalls: 0,
                      preAborted: Boolean(tracked?.signal.aborted),
                      dispatchFailed:
                        action.dispatchMode === "reject" || action.dispatchMode === "sync-throw",
                    };

                    const { onAbortMode } = action;
                    const onAbort =
                      onAbortMode === "none"
                        ? undefined
                        : (requestId: number) => {
                            rec.onAbortCalls += 1;
                            switch (onAbortMode) {
                              case "notify":
                                return client.notify(StagehandNotifications.browserbaseCancel, {
                                  requestId,
                                  reason: "cancelled",
                                });
                              case "throw":
                                throw new Error("onAbort sync throw");
                              case "reject":
                                return Promise.reject(new Error("onAbort async reject"));
                              case "hang":
                                return new Promise<void>(() => {});
                              default: {
                                const exhaustive: never = onAbortMode;
                                return exhaustive;
                              }
                            }
                          };

                    if (
                      tracked &&
                      !tracked.signal.aborted &&
                      action.abortDuringBinding &&
                      action.dispatchMode === "immediate"
                    ) {
                      bindingSideEffect = () => {
                        tracked.controller.abort(new Error("abort-during-binding"));
                      };
                    }

                    nextDispatchMode = action.dispatchMode;
                    const sentBefore = sentMessages.length;
                    const p = client.send(
                      StagehandMethods.contextPages,
                      {},
                      {
                        ...(tracked ? { signal: tracked.signal } : {}),
                        ...(onAbort ? { onAbort } : {}),
                      },
                    );
                    nextDispatchMode = "immediate";
                    bindingSideEffect = undefined;

                    rec.promise = p.then(
                      () => {
                        rec.settledCount += 1;
                        rec.status = "resolved";
                      },
                      () => {
                        rec.settledCount += 1;
                        rec.status = "rejected";
                      },
                    );
                    records.push(rec);
                    await flushMicrotasks();

                    if (rec.preAborted) {
                      expect(sentMessages.length).toBe(sentBefore);
                      expect(rec.onAbortCalls).toBe(0);
                      expect(client.pending.has(id)).toBe(false);
                    }
                    if (rec.dispatchFailed) {
                      expect(client.pending.has(id)).toBe(false);
                      expect(rec.status).toBe("rejected");
                    }
                    break;
                  }

                  case "resolveDispatch": {
                    const active = deferredDispatches.filter((d) => !d.settled);
                    if (active.length === 0) break;
                    const gate = active[action.idx % active.length]!;
                    if (action.ok) gate.resolve();
                    else gate.reject(new Error("deferred dispatch failed"));
                    await flushMicrotasks();
                    break;
                  }

                  case "respond": {
                    const pool =
                      action.pool === "pending"
                        ? records.filter((r) => r.status === "pending")
                        : action.pool === "settled"
                          ? records.filter((r) => r.status !== "pending")
                          : [];
                    const target =
                      pool.length > 0 ? pool[action.targetIdx % pool.length] : undefined;
                    const id = target ? target.id : 9_000 + action.targetIdx;

                    const payload =
                      action.kind === "null-id"
                        ? {
                            jsonrpc: "2.0",
                            id: null,
                            error: { code: JSONRPCErrorCodes.parseError, message: "bad" },
                          }
                        : action.kind === "error"
                          ? {
                              jsonrpc: "2.0",
                              id,
                              error: { code: JSONRPCErrorCodes.internalError, message: "err" },
                            }
                          : action.kind === "malformed-result"
                            ? { jsonrpc: "2.0", id, result: { not: "array" } }
                            : { jsonrpc: "2.0", id, result: [] };

                    await client.receive(JSON.stringify(payload));
                    await flushMicrotasks();
                    break;
                  }

                  case "abort": {
                    if (trackedSignals.length === 0) break;
                    const target = trackedSignals[action.targetIdx % trackedSignals.length]!;
                    const reason =
                      action.reasonKind === "error"
                        ? new Error("abort-err")
                        : action.reasonKind === "timeout"
                          ? new DOMException("abort-timeout", "TimeoutError")
                          : "string-reason";
                    target.controller.abort(reason);
                    await flushMicrotasks();
                    break;
                  }

                  case "notify": {
                    await client
                      .notify(StagehandNotifications.browserbaseCancel, {
                        requestId: 1,
                        reason: "cancelled",
                      })
                      .catch(() => {});
                    await flushMicrotasks();
                    break;
                  }

                  case "releaseClient": {
                    client.releaseClient();
                    await flushMicrotasks();
                    expect(client.pending.size).toBe(0);
                    break;
                  }

                  case "acceptClient": {
                    client.acceptClient();
                    break;
                  }

                  case "incoming": {
                    const raw =
                      action.variant === "invalid-json"
                        ? "{not-json"
                        : action.variant === "notification"
                          ? JSON.stringify({
                              jsonrpc: "2.0",
                              method: "browserbase.cancel",
                              params: { request_id: action.id, reason: "cancelled" },
                            })
                          : action.variant === "unknown-method"
                            ? JSON.stringify({
                                jsonrpc: "2.0",
                                id: action.id,
                                method: "no.such.method",
                                params: {},
                              })
                            : JSON.stringify({
                                jsonrpc: "2.0",
                                id: action.id,
                                method: StagehandMethods.stagehandMetrics.name,
                                params: {},
                              });
                    await client.receive(raw);
                    await flushMicrotasks();
                    break;
                  }

                  case "dropTransport": {
                    const err = new Error(`drop-${action.mode}`);
                    switch (action.mode) {
                      case "close":
                        client.close(err);
                        break;
                      case "onclose":
                        runtimeClient.onclose?.(err);
                        break;
                      case "onerror":
                        runtimeClient.onerror?.(err);
                        break;
                      default: {
                        const exhaustive: never = action.mode;
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

              for (const gate of deferredDispatches) {
                if (!gate.settled) gate.reject(new Error("end of run"));
              }
              client.close(new Error("end of run"));
              await Promise.all(records.map((r) => r.promise));
              await flushMicrotasks();

              for (const rec of records) {
                expect(rec.settledCount).toBe(1);
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
        { seed: 20260410, numRuns: 80 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });

  it("rejects delivery for in-flight incoming handlers on close and ignores new receive() calls after close", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 20 }),
            outcome: fc.constantFrom("resolve" as const, "reject" as const),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (requests) => {
          const sent: string[] = [];
          const runtimeClient = new ChromeRuntimeClient(
            {
              sendToHost(payload: string) {
                sent.push(payload);
              },
            },
            "sendToHost",
          );
          const runtime = createTestRuntime();
          const router = new RPCRouter(runtime);
          const gates: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

          vi.spyOn(router, "handle").mockImplementation(
            () =>
              new Promise((resolve, reject) => {
                gates.push({
                  resolve: () =>
                    resolve({
                      actPromptTokens: 0,
                      actCompletionTokens: 0,
                      actReasoningTokens: 0,
                      actCachedInputTokens: 0,
                      actInferenceTimeMs: 0,
                      extractPromptTokens: 0,
                      extractCompletionTokens: 0,
                      extractReasoningTokens: 0,
                      extractCachedInputTokens: 0,
                      extractInferenceTimeMs: 0,
                      observePromptTokens: 0,
                      observeCompletionTokens: 0,
                      observeReasoningTokens: 0,
                      observeCachedInputTokens: 0,
                      observeInferenceTimeMs: 0,
                      totalPromptTokens: 0,
                      totalCompletionTokens: 0,
                      totalReasoningTokens: 0,
                      totalCachedInputTokens: 0,
                      totalInferenceTimeMs: 0,
                    }),
                  reject,
                });
              }),
          );

          const client = new RPCClient(runtimeClient, router);
          const pending = requests.map((req) =>
            client
              .receive(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: req.id,
                  method: StagehandMethods.stagehandMetrics.name,
                  params: {},
                }),
              )
              .then(
                () => ({ status: "resolved" as const }),
                (error: unknown) => ({ status: "rejected" as const, error }),
              ),
          );
          await flushMicrotasks();

          client.close(new Error("closed mid-handler"));
          for (let i = 0; i < gates.length; i++) {
            const gate = gates[i]!;
            if (requests[i]?.outcome === "resolve") gate.resolve();
            else gate.reject(new Error("handler failed after close"));
          }

          const settled = await Promise.all(pending);
          for (const entry of settled) {
            expect(entry.status).toBe("rejected");
            if (entry.status === "rejected") {
              expect((entry.error as Error).message).toContain("closed");
            }
          }
          await expect(
            client.receive(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 999,
                method: StagehandMethods.stagehandMetrics.name,
                params: {},
              }),
            ),
          ).resolves.toBeUndefined();
          expect(sent).toStrictEqual([]);
        },
      ),
      { seed: 20260413, numRuns: 40 },
    );
  });

  it("verifies requestBrowserbase response reconstruction, error mapping, cancel correlation, and zero leaks", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const outcomeArb = fc.oneof(
      fc.record({
        kind: fc.constant("http" as const),
        status: fc.constantFrom(200, 201, 204, 205, 304, 400, 429, 500),
        hasContentType: fc.boolean(),
        body: fc.string({ maxLength: 40 }),
      }),
      fc.record({
        kind: fc.constant("transportError" as const),
        reason: fc.constantFrom(
          "network" as const,
          "cancelled" as const,
          "timeout" as const,
          "unavailable" as const,
          "disconnected" as const,
        ),
        message: fc.string({ minLength: 1, maxLength: 30 }),
      }),
      fc.record({
        kind: fc.constant("abort" as const),
        preAbort: fc.boolean(),
        isTimeout: fc.boolean(),
      }),
      fc.constant({ kind: "close" as const }),
      fc.constant({ kind: "malformed" as const }),
    );

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              operation: fc.constantFrom(
                "gateway.responses" as const,
                "cache.get" as const,
                "cache.set" as const,
              ),
              outcome: outcomeArb,
            }),
            { minLength: 1, maxLength: 8 },
          ),
          async (calls) => {
            const sent: Array<Record<string, unknown>> = [];
            const transport = new ChromeRuntimeClient(
              {
                send(payload: string) {
                  sent.push(JSON.parse(payload) as Record<string, unknown>);
                },
              },
              "send",
            );
            const client = new RPCClient(transport, new RPCRouter(createTestRuntime()));
            const trackedSignals: TrackedSignal[] = [];

            try {
              for (const call of calls) {
                if (client.closed) break;
                const params: BrowserbaseRequestParams = {
                  operation: call.operation,
                  headers: { "x-req": "1" },
                  body: "{}",
                };
                const tracked = call.outcome.kind === "abort" ? createTrackedSignal() : undefined;
                if (tracked) trackedSignals.push(tracked);
                if (tracked && call.outcome.kind === "abort" && call.outcome.preAbort) {
                  tracked.controller.abort(
                    call.outcome.isTimeout
                      ? new DOMException("timed out", "TimeoutError")
                      : new Error("aborted"),
                  );
                }

                const expectedId = client.nextRequestId;
                const pending = requestBrowserbase(client, params, tracked?.signal);

                switch (call.outcome.kind) {
                  case "http": {
                    const isNullBody = [204, 205, 304].includes(call.outcome.status);
                    const wire: BrowserbaseHttpResponse = {
                      type: "response",
                      status: call.outcome.status,
                      statusText: "Status",
                      headers: call.outcome.hasContentType
                        ? { "content-type": "application/json", "x-ok": "1" }
                        : { "x-ok": "1" },
                      body: isNullBody ? "" : call.outcome.body,
                    };
                    await transport.receive(
                      JSON.stringify({
                        jsonrpc: "2.0",
                        id: expectedId,
                        result: encodeWireValue(wire),
                      }),
                    );
                    const response = await pending;
                    expect(response.status).toBe(call.outcome.status);
                    expect(response.headers.has("content-type")).toBe(call.outcome.hasContentType);
                    expect(await response.text()).toBe(isNullBody ? "" : call.outcome.body);
                    break;
                  }

                  case "transportError": {
                    const wire: BrowserbaseTransportError = {
                      type: "error",
                      reason: call.outcome.reason,
                      message: call.outcome.message,
                    };
                    await transport.receive(
                      JSON.stringify({
                        jsonrpc: "2.0",
                        id: expectedId,
                        result: encodeWireValue(wire),
                      }),
                    );
                    const err = await pending.catch((e: unknown) => e);
                    switch (call.outcome.reason) {
                      case "network":
                        expect(err).toBeInstanceOf(TypeError);
                        expect((err as Error).message).toBe("fetch failed");
                        break;
                      case "cancelled":
                        expect(err).toBeInstanceOf(DOMException);
                        expect((err as DOMException).name).toBe("AbortError");
                        break;
                      case "timeout":
                        expect(err).toBeInstanceOf(DOMException);
                        expect((err as DOMException).name).toBe("TimeoutError");
                        break;
                      case "unavailable":
                      case "disconnected":
                        expect(err).toBeInstanceOf(Error);
                        expect((err as Error).message).toBe(call.outcome.message);
                        break;
                      default: {
                        const exhaustive: never = call.outcome.reason;
                        return exhaustive;
                      }
                    }
                    break;
                  }

                  case "abort": {
                    if (!call.outcome.preAbort) {
                      tracked!.controller.abort(
                        call.outcome.isTimeout
                          ? new DOMException("timed out", "TimeoutError")
                          : new Error("aborted"),
                      );
                    }
                    const err = await pending.catch((e: unknown) => e);
                    expect(err).toBeInstanceOf(DOMException);
                    expect((err as DOMException).name).toBe(
                      call.outcome.isTimeout ? "TimeoutError" : "AbortError",
                    );
                    if (!call.outcome.preAbort) {
                      expect(sent).toContainEqual({
                        jsonrpc: "2.0",
                        method: StagehandNotifications.browserbaseCancel.name,
                        params: {
                          request_id: expectedId,
                          reason: call.outcome.isTimeout ? "timeout" : "cancelled",
                        },
                      });
                    }
                    break;
                  }

                  case "close": {
                    client.close(new Error("transport dropped"));
                    await expect(pending).rejects.toThrow("Browserbase connection is disconnected");
                    break;
                  }

                  case "malformed": {
                    await transport.receive(
                      JSON.stringify({
                        jsonrpc: "2.0",
                        id: expectedId,
                        result: { type: "invalid" },
                      }),
                    );
                    await expect(pending).rejects.toThrow("Browserbase RPC request failed");
                    break;
                  }

                  default: {
                    const exhaustive: never = call.outcome;
                    return exhaustive;
                  }
                }
              }

              expect(client.pending.size).toBe(0);
              for (const tracked of trackedSignals) {
                expect(tracked.activeListeners()).toBe(0);
              }
            } finally {
              client.close();
            }
          },
        ),
        { seed: 20260411, numRuns: 70 },
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toStrictEqual([]);
  });
});
