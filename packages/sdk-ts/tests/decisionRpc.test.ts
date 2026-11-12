import { describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import type { DecisionChooseResult } from "@browserbasehq/stagehand-protocol/types";
import { registerDecisionHandler, type DecisionContext } from "../src/decisionRpc.js";
import { RPCClient, type CDPTransport } from "../src/rpcClient.js";

const params = { prompt: "Save", candidates: [{ id: "0-1", description: "Save button" }] };
function harness(choose: Parameters<typeof registerDecisionHandler>[1]) {
  const sent: JSONRPCMessage[] = [];
  const transport: CDPTransport = {
    serviceWorker: {
      targetId: "test",
      url: "chrome-extension://test",
      title: "test",
      extensionId: "test",
    },
    send: async (message) => {
      sent.push(message);
    },
    close: () => {},
  };
  const client = new RPCClient(transport);
  const remove = registerDecisionHandler(client, choose);
  return {
    client,
    remove,
    sent,
    request: (id: number, timeoutMs?: number) =>
      client.receive({
        jsonrpc: "2.0",
        id,
        method: "decision.choose",
        params: { ...params, ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }) },
      }),
    cancel: (id: number) =>
      client.receive({
        jsonrpc: "2.0",
        method: "decision.cancel",
        params: { request_id: id, reason: "cancelled" },
      }),
  };
}

describe("decision cancellation", () => {
  it("isolates concurrent IDs and discards results from a callback that ignores cancellation", async () => {
    const contexts = new Map<number, DecisionContext>();
    const completions = new Map<
      number,
      ReturnType<typeof Promise.withResolvers<DecisionChooseResult>>
    >();
    const started = Promise.withResolvers<void>();
    const h = harness(async (_, context) => {
      contexts.set(context.requestId, context);
      const completion = Promise.withResolvers<DecisionChooseResult>();
      completions.set(context.requestId, completion);
      if (contexts.size === 2) started.resolve();
      return completion.promise;
    });
    try {
      const first = h.request(1);
      const second = h.request(2);
      await started.promise;
      expect(contexts.get(1)!.remainingMs()).toBe(Infinity);
      await h.cancel(999);
      await h.cancel(1);
      await first;
      expect(contexts.get(1)!.signal.aborted).toBe(true);
      expect(contexts.get(2)!.signal.aborted).toBe(false);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]).toMatchObject({ id: 1, error: { message: "Decision cancelled" } });
      completions.get(1)!.resolve({ status: "selected", id: "0-1" });
      completions.get(2)!.resolve({ status: "no_match" });
      await second;
      await h.cancel(2);
      expect(h.sent).toHaveLength(2);
      expect(h.sent[1]).toMatchObject({ id: 2, result: { status: "no_match" } });
    } finally {
      h.client.close();
    }
  });

  it("enforces the local budget even if the cancellation notification never arrives", async () => {
    vi.useFakeTimers();
    let callbackContext: DecisionContext | undefined;
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<DecisionChooseResult>();
    const h = harness(async (_, context) => {
      callbackContext = context;
      started.resolve();
      return completion.promise;
    });
    try {
      const request = h.request(1, 50);
      await started.promise;
      expect(callbackContext!.remainingMs()).toBeGreaterThan(0);
      expect(callbackContext!.remainingMs()).toBeLessThanOrEqual(50);
      await vi.advanceTimersByTimeAsync(51);
      await request;
      expect(callbackContext!.signal.aborted).toBe(true);
      expect(h.sent[0]).toMatchObject({ id: 1, error: { data: { name: "TimeoutError" } } });
      completion.resolve({ status: "selected", id: "0-1" });
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sent).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      h.client.close();
      vi.useRealTimers();
    }
  });

  it("does not invoke a callback with an exhausted budget", async () => {
    const choose = vi.fn(async (): Promise<DecisionChooseResult> => ({ status: "no_match" }));
    const h = harness(choose);
    try {
      await h.request(1, 0);
      expect(choose).not.toHaveBeenCalled();
      expect(h.sent[0]).toMatchObject({ error: { data: { name: "TimeoutError" } } });
    } finally {
      h.client.close();
    }
  });

  it.each(["remove", "close"] as const)("stops pending callbacks on %s", async (operation) => {
    let callbackContext: DecisionContext | undefined;
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<DecisionChooseResult>();
    const h = harness(async (_, context) => {
      callbackContext = context;
      started.resolve();
      return completion.promise;
    });
    try {
      const request = h.request(1);
      await started.promise;
      if (operation === "remove") h.remove();
      else h.client.close();
      await request;
      expect(callbackContext!.signal.aborted).toBe(true);
      completion.reject(new Error("late failure"));
      await Promise.resolve();
      if (operation === "close") expect(h.sent).toEqual([]);
    } finally {
      h.client.close();
    }
  });
});
