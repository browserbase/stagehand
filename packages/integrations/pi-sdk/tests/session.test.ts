import { describe, expect, it, vi } from "vitest";
import {
  buildPiMcpToolName,
  buildPiTranscript,
  definePiCodeRunTool,
  isPiMcpToolName,
  mcpCallResultToPiToolResult,
  normalizePiModel,
  resolvePiStatus,
  runPiSession,
  type PiAgentSessionLike,
  type PiEvent,
  type PiSdk,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function scriptedSdk(
  events: PiEvent[],
  options?: { createError?: Error; promptUntilAbort?: boolean },
) {
  let disposeCount = 0;
  let abortCount = 0;
  let createOptions: Record<string, unknown> | undefined;
  const sdk: PiSdk = {
    async createSession(input) {
      createOptions = input;
      if (options?.createError) throw options.createError;
      const listeners = new Set<(event: PiEvent) => void>();
      let resolvePrompt: (() => void) | undefined;
      const session: PiAgentSessionLike = {
        agent: { state: {} },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt() {
          if (options?.promptUntilAbort) {
            await new Promise<void>((resolve) => {
              resolvePrompt = resolve;
            });
          }
          for (const event of events) {
            for (const listener of listeners) listener(event);
            if (event.type === "turn_end" && (await session.agent.shouldStopAfterTurn?.())) break;
          }
        },
        async abort() {
          abortCount += 1;
          resolvePrompt?.();
        },
        dispose() {
          disposeCount += 1;
        },
      };
      return session;
    },
  };
  return {
    sdk,
    get disposeCount() {
      return disposeCount;
    },
    get abortCount() {
      return abortCount;
    },
    get createOptions() {
      return createOptions;
    },
  };
}

function assistant(text: string, usage: Record<string, unknown>, stopReason = "stop"): PiEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage,
      stopReason,
    },
  };
}

describe("pi SDK session", () => {
  it("collects output, usage, tool results, and forwarded options", async () => {
    const fake = scriptedSdk([
      assistant("working", {
        input: 10,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 19,
        cost: { total: 0.1 },
      }),
      { type: "message_update", delta: "ignored" },
      { type: "tool_execution_end", toolCallId: "1", toolName: "browser", result: {} },
      { type: "turn_end" },
      assistant("done", {
        input: 5,
        output: 6,
        cacheRead: 1,
        cacheWrite: 2,
        reasoning: 7,
        totalTokens: 14,
        cost: { total: 0.2 },
      }),
      { type: "turn_end" },
    ]);
    const onToolResult = vi.fn();
    const customTool = definePiCodeRunTool({
      name: "browser",
      description: "run",
      codeParamDescription: "code",
      execute: async () => "ok",
    });
    const result = await runPiSession({
      prompt: "task",
      model: "openai/gpt-5.4-mini",
      sdk: fake.sdk,
      logger,
      session: {
        cwd: "/tmp/pi-test",
        systemPrompt: "system",
        customTools: [customTool],
      },
      onToolResult,
    });

    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe("done");
    expect(result.turns).toBe(2);
    expect(result.events.some((event) => event.type === "message_update")).toBe(false);
    expect(result.tokenUsage).toEqual({
      inputTokens: 15,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 6,
      reasoningTokens: 7,
      totalTokens: 33,
      costUsd: 0.30000000000000004,
    });
    expect(onToolResult).toHaveBeenCalledWith("browser");
    expect(fake.createOptions).toMatchObject({
      cwd: "/tmp/pi-test",
      systemPrompt: "system",
      customTools: [customTool],
    });
    expect(fake.disposeCount).toBe(1);
  });

  it("stops at the turn budget", async () => {
    const fake = scriptedSdk([
      assistant("one", {}, "toolUse"),
      { type: "turn_end" },
      assistant("two", {}, "toolUse"),
      { type: "turn_end" },
      assistant("three", {}, "toolUse"),
      { type: "turn_end" },
    ]);
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: fake.sdk,
      logger,
      session: { maxTurns: 2 },
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe("turn budget exhausted (2 turns)");
    expect(result.turns).toBe(2);
    expect(fake.disposeCount).toBe(1);
  });

  it("redacts provider errors", async () => {
    const event = assistant("", {}, "error");
    (event.message as Record<string, unknown>).errorMessage = "bad sk-abcdef1234567890";
    const fake = scriptedSdk([event]);
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: fake.sdk,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("bad sk-abcdef[redacted]");
    expect(fake.disposeCount).toBe(1);
  });

  it("treats provider length limits as SDK errors", async () => {
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: scriptedSdk([assistant("cut off", {}, "length")]).sdk,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toMatch(/length limit/);
  });

  it("treats internal pi aborts as SDK errors", async () => {
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: scriptedSdk([assistant("", {}, "aborted")]).sdk,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("pi aborted the run");
  });

  it("redacts internal pi abort errors", async () => {
    const event = assistant("", {}, "aborted");
    (event.message as Record<string, unknown>).errorMessage = "boom sk-abcdef1234567890";
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: scriptedSdk([event]).sdk,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("boom sk-abcdef[redacted]");
  });

  it("redacts tool and unknown event summaries without mutating events", async () => {
    const toolEvent: PiEvent = {
      type: "tool_execution_end",
      toolName: "browser",
      args: { token: "sk-abcdef1234567890" },
      result: { token: "sk-abcdef1234567890" },
    };
    const unknownEvent: PiEvent = {
      type: "provider_notice",
      errorMessage: "bb_live_abcd1234567890",
    };
    const recordingLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: scriptedSdk([toolEvent, unknownEvent]).sdk,
      logger: recordingLogger,
      session: {},
    });

    const logged = JSON.stringify(recordingLogger.log.mock.calls);
    expect(logged).not.toContain("sk-abcdef1234567890");
    expect(logged).not.toContain("bb_live_abcd1234567890");
    const transcript = buildPiTranscript(result.events);
    expect(transcript).toContain("sk-abcdef[redacted]");
    expect(transcript).toContain("bb_live_abcd[redacted]");
    expect(transcript).not.toContain("sk-abcdef1234567890");
    expect(transcript).not.toContain("bb_live_abcd1234567890");
    expect(toolEvent.result).toEqual({ token: "sk-abcdef1234567890" });
  });

  it("captures createSession failures without throwing", async () => {
    const fake = scriptedSdk([], { createError: new Error("create failed") });
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: fake.sdk,
      logger,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(String(result.iterationError)).toContain("create failed");
    expect(fake.disposeCount).toBe(0);
  });

  it("forwards an already-aborted signal", async () => {
    const fake = scriptedSdk([]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const result = await runPiSession({
      prompt: "task",
      model: "model",
      sdk: fake.sdk,
      signal: controller.signal,
      logger,
      session: {},
    });
    expect(fake.abortCount).toBe(1);
    expect(fake.disposeCount).toBe(1);
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("cancelled");
  });

  it("forwards an active abort and removes the signal listener", async () => {
    const fake = scriptedSdk([], { promptUntilAbort: true });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const execution = runPiSession({
      prompt: "task",
      model: "model",
      sdk: fake.sdk,
      signal: controller.signal,
      logger,
      session: {},
    });
    await vi.waitFor(() => expect(fake.createOptions).toBeDefined());

    controller.abort(new Error("active cancellation"));
    const result = await execution;

    expect(fake.abortCount).toBe(1);
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("active cancellation");
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("normalizes models, MCP names/results, code tools, and statuses", async () => {
    expect(normalizePiModel("pi/default")).toBe("openai/gpt-5.4-mini");
    expect(normalizePiModel("google/gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
    expect(buildPiMcpToolName("stage.hand", "take shot")).toBe("mcp__stage_hand__take_shot");
    expect(isPiMcpToolName("mcp__stage_hand__run", "stage.hand")).toBe(true);
    expect(isPiMcpToolName("other")).toBe(false);
    const mapped = mcpCallResultToPiToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "YWJj", mimeType: "image/png" },
      ],
      structuredContent: { ok: false },
      isError: true,
    });
    expect(mapped).toMatchObject({ isError: true, details: { ok: false } });
    expect(mapped.content).toHaveLength(2);

    const execute = vi.fn(async (code: string) => `ran ${code}`);
    const tool = definePiCodeRunTool({
      name: "run",
      description: "run code",
      codeParamDescription: "snippet",
      execute,
    });
    expect((tool.parameters as { properties: object }).properties).toHaveProperty("code");
    const output = await tool.execute(
      "id",
      { code: "return 1" },
      undefined,
      undefined,
      {} as never,
    );
    expect(output.content).toEqual([{ type: "text", text: "ran return 1" }]);
    expect(execute).toHaveBeenCalledWith("return 1", undefined);

    expect(
      resolvePiStatus({ iterationError: undefined, stopReason: undefined, budgetExhausted: false }),
    ).toBe("completed");
    expect(
      resolvePiStatus({ iterationError: undefined, stopReason: undefined, budgetExhausted: true }),
    ).toBe("max_turns");
    expect(resolvePiStatus({ iterationError: new Error("x"), budgetExhausted: false })).toBe(
      "sdk_error",
    );
  });
});
