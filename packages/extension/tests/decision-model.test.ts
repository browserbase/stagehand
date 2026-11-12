import { describe, expect, it, vi } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
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

describe("client decision worker adapter", () => {
  it.each<DecisionChooseResult>([
    { status: "selected", id: "0-1", usage: { inputTokens: 4 }, diagnostics: { keep_this: true } },
    { status: "no_match" },
    { status: "refused" },
  ])("returns $status through the worker and SDK RPC clients", async (result) => {
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
      clientDecisionChoose: (input) => rpc.send(StagehandMethods.decisionChoose, input),
    });
    const rpc = new workerRpc.RPCClient(transport, new RPCRouter(runtime));
    runtime.state.setState({ status: "initialized", initParams }, true);
    const choose = vi.fn(async () => result);
    const remove = registerDecisionHandler(client, choose);
    try {
      await expect(runtime.chooseDecision(params)).resolves.toEqual(result);
      expect(choose).toHaveBeenCalledExactlyOnceWith(
        params,
        expect.objectContaining({ requestId: 1 }),
      );
    } finally {
      remove();
      client.close();
      rpc.close();
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
