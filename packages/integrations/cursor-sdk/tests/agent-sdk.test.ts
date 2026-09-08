import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@cursor/sdk";
import {
  runCursorSdkAgentSession,
  type CursorSdkAgent,
  type CursorSdkAgentFactory,
  type CursorSdkRun,
  type CursorSdkSessionInput,
} from "../src/agent-sdk.js";
import { extractCursorToolCall } from "../src/events.js";

const mount = { stagehand: { command: "node", args: ["shared-relay.js"], env: { PORT: "1234" } } };
const base: Omit<CursorSdkSessionInput, "createAgent"> = {
  prompt: "exact task prompt",
  model: "cursor/grok-4.6",
  cwd: "/tmp/cursor-sdk-boundary-test",
  mcpServers: mount,
  logger: { log: () => {}, warn: () => {}, error: () => {} },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function tool(status: "running" | "completed" | "error", result?: unknown) {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: "run-1",
    call_id: "call-1",
    name: "mcp",
    status,
    args: { providerIdentifier: "stagehand", toolName: "run", args: { code: "return page.url()" } },
    ...(result === undefined ? {} : { result }),
  };
}

function fixture(events: unknown[] = []) {
  const run: CursorSdkRun = {
    stream: async function* () {
      yield* events;
    },
    wait: vi.fn(async () => ({ status: "finished", result: "done" })),
    cancel: vi.fn(async () => {}),
  };
  const agent: CursorSdkAgent = {
    send: vi.fn(async () => run),
    close: vi.fn(),
  };
  const createAgent = vi.fn<CursorSdkAgentFactory>(async () => agent);
  return { run, agent, createAgent };
}

describe("Cursor SDK shared-mount boundary", () => {
  it("reports a missing API key before calling the SDK", async () => {
    vi.stubEnv("CURSOR_API_KEY", "");
    const create = vi.spyOn(Agent, "create").mockRejectedValue(new Error("Unexpected SDK call"));
    const result = await runCursorSdkAgentSession(base);
    expect(result).toMatchObject({
      status: "sdk_error",
      stopReason: "CURSOR_API_KEY is required for the Cursor SDK harness.",
      events: [],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a supplied mount before creating an agent", async () => {
    const f = fixture();
    await expect(
      runCursorSdkAgentSession({ ...base, mcpServers: {}, createAgent: f.createAgent }),
    ).rejects.toThrow("shared MCP mount");
    expect(f.createAgent).not.toHaveBeenCalled();
  });

  it("passes the same mount and prompt and closes the agent after success", async () => {
    const f = fixture();
    const result = await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(f.createAgent.mock.calls[0][0].mcpServers === mount).toBe(true);
    expect(f.agent.send).toHaveBeenCalledWith(base.prompt);
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(f.run.cancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed", resultText: "done" });
  });

  it("notifies observations with the concrete tool name and retains MCP content", async () => {
    const content = [
      { type: "text", text: "[1] heading Shoes" },
      { type: "image", data: "iVBORw==", mimeType: "image/png" },
    ];
    const f = fixture([tool("running"), tool("completed", { content, isError: false })]);
    const onToolResult = vi.fn();
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      onToolResult,
    });
    expect(onToolResult).toHaveBeenCalledExactlyOnceWith("stagehand.run");
    expect(extractCursorToolCall(result.events[1])).toMatchObject({
      name: "stagehand.run",
      subtype: "completed",
      ok: true,
      result: { content, isError: false },
    });
  });

  it("normalizes SDK thinking deltas and their completion boundary for the shared adapter", async () => {
    const f = fixture([
      { type: "thinking", text: "Inspect the " },
      { type: "thinking", text: "current page." },
      { type: "thinking", text: "", thinking_duration_ms: 120 },
      tool("running"),
      tool("completed", "ok"),
    ]);
    const result = await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(result.events.slice(0, 3)).toEqual([
      { type: "thinking", subtype: "delta", text: "Inspect the " },
      { type: "thinking", subtype: "delta", text: "current page." },
      { type: "thinking", subtype: "completed", text: "", thinking_duration_ms: 120 },
    ]);
    expect(result.resultText).toBe("done");
  });

  it("treats the SDK error status as a completed failed call", async () => {
    const f = fixture([tool("running"), tool("error", { message: "tool denied" })]);
    const onToolResult = vi.fn();
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      onToolResult,
    });
    expect(onToolResult).toHaveBeenCalledExactlyOnceWith("stagehand.run");
    expect(extractCursorToolCall(result.events[1])).toMatchObject({
      subtype: "completed",
      ok: false,
    });
    expect(extractCursorToolCall(result.events[1])?.error).toContain("tool denied");
  });

  it("counts only completed calls and reports an explicit step-budget stop", async () => {
    const f = fixture([
      tool("running"),
      tool("running"),
      tool("completed", "first"),
      tool("completed", "extra"),
    ]);
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      maxToolSteps: 1,
    });
    expect(result.events).toHaveLength(3);
    expect(f.run.cancel).toHaveBeenCalledOnce();
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "max_turns",
      stopReason: "tool step budget exhausted (1 steps)",
    });
  });

  it("cancels a running stream on external abort and retains prior events", async () => {
    const controller = new AbortController();
    const f = fixture();
    f.run.stream = async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: "working" }] } };
      controller.abort(new Error("caller aborted"));
      await new Promise(() => {});
    };
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      signal: controller.signal,
    });
    expect(result.events).toHaveLength(1);
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "caller aborted" });
    expect(f.run.cancel).toHaveBeenCalledOnce();
    expect(f.agent.close).toHaveBeenCalledOnce();
  });

  it("retains and sanitizes stream failures and still cancels/closes", async () => {
    const f = fixture();
    f.run.stream = async function* () {
      yield tool("running");
      throw new Error("failed https://x.test?apiKey=secret-value");
    };
    const result = await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("apiKey=[redacted]");
    expect(result.events).toHaveLength(1);
    expect(f.run.cancel).toHaveBeenCalledOnce();
    expect(f.agent.close).toHaveBeenCalledOnce();
  });

  it("bounds cancellation and terminal wait even when the SDK never settles", async () => {
    vi.useFakeTimers();
    const f = fixture([tool("completed", "one")]);
    f.run.cancel = vi.fn(() => new Promise<void>(() => {}));
    f.run.wait = vi.fn(() => new Promise<never>(() => {}));
    const promise = runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      maxToolSteps: 1,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;
    expect(result.status).toBe("max_turns");
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the SDK asynchronous disposer when available", async () => {
    const f = fixture();
    f.agent[Symbol.asyncDispose] = vi.fn(async () => {});
    await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(f.agent[Symbol.asyncDispose]).toHaveBeenCalledOnce();
    expect(f.agent.close).not.toHaveBeenCalled();
  });

  it("does not create an agent when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller aborted"));
    const f = fixture();
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "caller aborted" });
    expect(f.createAgent).not.toHaveBeenCalled();
  });

  it("closes an agent whose send fails", async () => {
    const f = fixture();
    f.agent.send = vi.fn(async () => {
      throw new Error("send failed");
    });
    const result = await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "send failed" });
    expect(f.agent.close).toHaveBeenCalledOnce();
  });

  it("aborts pending creation and disposes an agent that resolves afterward", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const f = fixture();
    let resolveAgent!: (agent: CursorSdkAgent) => void;
    const createAgent = vi.fn<CursorSdkAgentFactory>(
      () =>
        new Promise((resolve) => {
          resolveAgent = resolve;
        }),
    );
    const settled = vi.fn();
    const promise = runCursorSdkAgentSession({
      ...base,
      createAgent,
      signal: controller.signal,
    }).then(settled);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("aborted during creation"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sdk_error", stopReason: "aborted during creation" }),
    );
    expect(f.agent.send).not.toHaveBeenCalled();
    resolveAgent(f.agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(f.agent.send).not.toHaveBeenCalled();
    await promise;
  });

  it.each(["resolve", "reject"] as const)(
    "cleans an executor acquired after send abort (%s)",
    async (outcome) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const f = fixture();
      let executorHeld = false;
      f.agent.close = vi.fn(() => {
        executorHeld = false;
      });
      let resolveRun!: (run: CursorSdkRun) => void;
      let rejectRun!: (error: Error) => void;
      f.agent.send = vi.fn(
        () =>
          new Promise<CursorSdkRun>((resolve, reject) => {
            resolveRun = resolve;
            rejectRun = reject;
          }),
      );
      f.run.stream = vi.fn();
      const settled = vi.fn();
      const promise = runCursorSdkAgentSession({
        ...base,
        createAgent: f.createAgent,
        signal: controller.signal,
      }).then(settled);
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(new Error("aborted during send"));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledWith(
        expect.objectContaining({ status: "sdk_error", stopReason: "aborted during send" }),
      );
      expect(f.agent.close).toHaveBeenCalledOnce();
      executorHeld = true; // SDK send() acquires its executor after async store/model setup.
      if (outcome === "resolve") resolveRun(f.run);
      else rejectRun(new Error("late send failed after executor setup"));
      await vi.advanceTimersByTimeAsync(0);
      expect(executorHeld).toBe(false);
      expect(f.agent.close).toHaveBeenCalledTimes(2);
      expect(f.run.cancel).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
      expect(f.run.wait).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
      expect(f.run.stream).not.toHaveBeenCalled();
      await promise;
    },
  );

  it("bounds cleanup of a late run whose cancel and wait both stall", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const f = fixture();
    let resolveRun!: (run: CursorSdkRun) => void;
    f.agent.send = vi.fn(
      () =>
        new Promise<CursorSdkRun>((resolve) => {
          resolveRun = resolve;
        }),
    );
    f.run.cancel = vi.fn(() => new Promise<void>(() => {}));
    f.run.wait = vi.fn(() => new Promise<never>(() => {}));
    const settled = vi.fn();
    const promise = runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      signal: controller.signal,
    }).then(settled);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledOnce();
    resolveRun(f.run);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.run.cancel).toHaveBeenCalledOnce();
    expect(f.run.wait).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await promise;
  });

  it("falls back to close when asynchronous disposal stalls", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.agent[Symbol.asyncDispose] = vi.fn(() => new Promise<void>(() => {}));
    const promise = runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await promise).status).toBe("completed");
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds the terminal wait after the event stream ends", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.run.wait = vi.fn(() => new Promise<never>(() => {}));
    const promise = runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    expect(result).toMatchObject({
      status: "sdk_error",
      stopReason: "Cursor SDK terminal wait timed out after 30000ms",
    });
    expect(f.run.cancel).toHaveBeenCalledOnce();
    expect(f.agent.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Cursor SDK log and usage provenance", () => {
  it("logs complete SDK results at debug and failures visibly without stream fragments", async () => {
    const f = fixture([
      { type: "thinking", text: "fragment" },
      tool("running"),
      tool("completed", { content: [{ type: "text", text: "ok" }] }),
      tool("completed", { isError: true, content: [{ type: "text", text: "denied" }] }),
    ]);
    const log = vi.fn();
    const result = await runCursorSdkAgentSession({
      ...base,
      createAgent: f.createAgent,
      logger: { ...base.logger, log },
    });
    expect(result.events).toHaveLength(4);
    expect(log.mock.calls.map(([entry]) => entry.level)).toEqual([2, 1]);
    expect(log.mock.calls[1]?.[0].message).toContain("denied");
    expect(log.mock.calls.map(([entry]) => entry.message).join("\n")).not.toContain("fragment");
  });
  it.each([
    [undefined, false],
    [{ inputTokens: 0, outputTokens: 0 }, true],
  ] as const)("distinguishes missing usage from explicit zeros (%j)", async (usage, reported) => {
    const f = fixture();
    f.run.wait = async () => ({ status: "finished", result: "done", usage });
    const result = await runCursorSdkAgentSession({ ...base, createAgent: f.createAgent });
    expect(result.tokenUsage.reported).toBe(reported);
    expect(result.tokenUsage.totalTokens).toBe(0);
  });
});
