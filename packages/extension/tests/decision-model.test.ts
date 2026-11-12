import { describe, expect, it, vi } from "vitest";
import { requestDecision } from "../clients/decisionClient.js";
import { Progress } from "../understudy/progress.js";
import {
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { DecisionChooseResult } from "@browserbasehq/stagehand-protocol/types";
import { createStagehandRuntime } from "../runtime.js";
import { DecisionModelNotConfiguredError } from "../errors.js";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import * as workerRpc from "../clients/rpcClient.js";
import { RPCRouter } from "../rpcRouter.js";
import { RPCClient, type CDPTransport } from "../../sdk-ts/src/rpcClient.js";
import { registerDecisionHandler } from "../../sdk-ts/src/decisionRpc.js";

const params = { prompt: "Save", candidates: [{ id: "0-1", description: "Save button" }] };
const initParams = StagehandInitParamsSchema.parse({
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "test", version: "1.0.0" },
  decisionModel: { source: "client" },
});

function createDecisionHarness(choose: Parameters<typeof registerDecisionHandler>[1]) {
  const sdkTransport: CDPTransport = {
    serviceWorker: {
      targetId: "test",
      url: "chrome-extension://test",
      title: "test",
      extensionId: "test",
    },
    send: async (message) => transport.receive(JSON.stringify(message)),
    close: () => {},
  };
  const client = new RPCClient(sdkTransport);
  const transport = new ChromeRuntimeClient(
    {
      send: (raw: string) => {
        void sdkTransport.onmessage?.(JSON.parse(raw));
      },
    },
    "send",
  );
  const runtime = createStagehandRuntime({
    clientDecisionChoose: (input, signal) => requestDecision(rpc, input, signal),
  });
  const rpc = new workerRpc.RPCClient(transport, new RPCRouter(runtime));
  runtime.state.setState({ status: "initialized", initParams }, true);
  const remove = registerDecisionHandler(client, choose);
  return {
    runtime,
    rpc,
    client,
    close: () => {
      remove();
      client.close();
      rpc.close();
    },
  };
}

describe("client decision worker adapter", () => {
  it.each<DecisionChooseResult>([
    { status: "selected", id: "0-1", usage: { inputTokens: 4 }, diagnostics: { keep_this: true } },
    { status: "no_match" },
    { status: "refused" },
  ])("returns $status through the worker and SDK RPC clients", async (result) => {
    const choose = vi.fn(async () => result);
    const { runtime, close } = createDecisionHarness(choose);
    try {
      await expect(runtime.chooseDecision(params)).resolves.toEqual(result);
      expect(choose).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(params),
        expect.objectContaining({ requestId: 1 }),
      );
    } finally {
      close();
    }
  });

  it("requires a configured decision callback without falling back to generation", async () => {
    const generate = vi.fn();
    const choose = vi.fn();
    const runtime = createStagehandRuntime({
      clientLLMGenerate: generate,
      clientDecisionChoose: choose,
    });
    const { decisionModel: _decisionModel, ...withoutDecision } = initParams;
    runtime.state.setState(
      { status: "initialized", initParams: { ...withoutDecision, model: { source: "client" } } },
      true,
    );
    await expect(runtime.chooseDecision(params)).rejects.toBeInstanceOf(
      DecisionModelNotConfiguredError,
    );
    expect(choose).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    const missingAdapter = createStagehandRuntime();
    missingAdapter.state.setState({ status: "initialized", initParams }, true);
    await expect(missingAdapter.chooseDecision(params)).rejects.toBeInstanceOf(
      DecisionModelNotConfiguredError,
    );
  });

  it("checks selection membership again at the worker boundary", async () => {
    const runtime = createStagehandRuntime({
      clientDecisionChoose: async () => ({ status: "selected", id: "another-node" }),
    });
    runtime.state.setState({ status: "initialized", initParams }, true);
    await expect(runtime.chooseDecision(params)).rejects.toThrow("outside the supplied candidates");
  });

  it("does not deliver a decision to an instance that was disposed while waiting", async () => {
    let complete!: (result: DecisionChooseResult) => void;
    const started = Promise.withResolvers<void>();
    const runtime = createStagehandRuntime({
      clientDecisionChoose: async () => {
        started.resolve();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    runtime.state.setState({ status: "initialized", initParams }, true);
    const pending = runtime.chooseDecision(params);
    await started.promise;
    await runtime.disposeStagehandInstance();
    complete({ status: "selected", id: "0-1" });
    await expect(pending).rejects.toThrow("no longer active");
  });
});

describe("decision operation lifecycle", () => {
  it("does not dispatch a decision after disposal starts", async () => {
    const choose = vi.fn(async (): Promise<DecisionChooseResult> => ({ status: "no_match" }));
    const h = createDecisionHarness(choose);
    try {
      const pending = h.runtime.chooseDecision(params);
      const rejected = expect(pending).rejects.toThrow("no longer active");
      await h.runtime.disposeStagehandInstance();
      await rejected;
      expect(choose).not.toHaveBeenCalled();
      expect(h.rpc.pending.size).toBe(0);
    } finally {
      h.close();
    }
  });

  it("passes the remaining operation budget and cancels only the expired request", async () => {
    vi.useFakeTimers();
    const firstProgress = new Progress("first", 100);
    const secondProgress = new Progress("second", 0);
    const started = Promise.withResolvers<void>();
    const completions = [
      Promise.withResolvers<DecisionChooseResult>(),
      Promise.withResolvers<DecisionChooseResult>(),
    ];
    const signals: AbortSignal[] = [];
    const budgets: (number | undefined)[] = [];
    const h = createDecisionHarness(async (input, context) => {
      const index = signals.length;
      signals.push(context.signal);
      budgets.push(input.timeoutMs);
      if (signals.length === 2) started.resolve();
      return completions[index]!.promise;
    });
    try {
      await vi.advanceTimersByTimeAsync(40);
      const first = h.runtime.chooseDecision(params, firstProgress);
      const rejected = expect(first).rejects.toThrow("timed out");
      const second = h.runtime.chooseDecision(params, secondProgress);
      await started.promise;
      expect(budgets[0]).toBeGreaterThan(0);
      expect(budgets[0]).toBeLessThanOrEqual(60);
      expect(budgets[1]).toBeUndefined();
      await vi.advanceTimersByTimeAsync(61);
      await rejected;
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);
      expect(h.rpc.pending.size).toBe(1);
      completions[0]!.resolve({ status: "selected", id: "0-1" });
      completions[1]!.resolve({ status: "no_match" });
      await expect(second).resolves.toEqual({ status: "no_match" });
      expect(h.rpc.pending.size).toBe(0);
    } finally {
      h.close();
      firstProgress.dispose();
      secondProgress.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["dispose", "disconnect"] as const)(
    "releases pending requests on %s",
    async (operation) => {
      const started = Promise.withResolvers<AbortSignal>();
      const completion = Promise.withResolvers<DecisionChooseResult>();
      const h = createDecisionHarness(async (_, context) => {
        started.resolve(context.signal);
        return completion.promise;
      });
      const progress = new Progress("decision", 0);
      const release = h.runtime.acquireStagehandInstanceRequest();
      try {
        const pending = h.runtime.chooseDecision(params, progress).finally(release);
        const rejected = expect(pending).rejects.toThrow();
        const signal = await started.promise;
        if (operation === "dispose") await h.runtime.disposeStagehandInstance();
        else {
          h.client.close();
          h.rpc.releaseClient();
        }
        await rejected;
        expect(signal.aborted).toBe(true);
        expect(h.rpc.pending.size).toBe(0);
        completion.resolve({ status: "selected", id: "0-1" });
      } finally {
        h.close();
        progress.dispose();
        release();
      }
    },
  );
});
