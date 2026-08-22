/* eslint-disable require-yield */
import { describe, expect, it, vi } from "vitest";
import {
  normalizeMastraModel,
  runMastraSession,
  type MastraEvent,
  type MastraSdk,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function streamEvents(events: MastraEvent[]): AsyncIterable<MastraEvent> {
  return (async function* () {
    yield* events;
  })();
}

function fakeSdk(
  input: {
    events?: MastraEvent[];
    streamError?: Error;
    discoveryErrors?: Record<string, string>;
    agentConfig?: (config: Record<string, unknown>) => void;
    streamOptions?: (options: Record<string, unknown> | undefined) => void;
    servers?: (servers: Record<string, unknown>) => void;
    disconnect?: () => void;
    createAgent?: () => void;
  } = {},
): MastraSdk {
  return {
    createAgent: (config) => {
      input.createAgent?.();
      input.agentConfig?.(config);
      return {
        stream: async (_prompt, options) => {
          input.streamOptions?.(options);
          if (input.streamError) throw input.streamError;
          return {
            fullStream: streamEvents(input.events ?? []),
            text: Promise.resolve("fallback text"),
          };
        },
      };
    },
    createMcpClient: (options) => {
      input.servers?.(options.servers);
      return {
        listToolsWithErrors: async () => ({
          tools: { stagehand_run: { id: "run" } },
          errors: input.discoveryErrors ?? {},
        }),
        disconnect: async () => input.disconnect?.(),
      };
    },
    createTool: (options) => options,
  };
}

describe("Mastra SDK session", () => {
  it("normalizes provider-prefixed, bare, and default models", () => {
    expect(normalizeMastraModel("anthropic/claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(normalizeMastraModel("gpt-5.4")).toBe("openai/gpt-5.4");
    expect(normalizeMastraModel("mastra/default")).toBe("openai/gpt-5.4-mini");
  });

  it("forwards agent and stream options and merges MCP tools", async () => {
    let agentConfig: Record<string, unknown> | undefined;
    let streamOptions: Record<string, unknown> | undefined;
    let servers: Record<string, unknown> | undefined;
    const signal = new AbortController().signal;
    await runMastraSession({
      prompt: "task",
      model: "anthropic/claude-sonnet-4-6",
      logger,
      signal,
      sdk: fakeSdk({
        agentConfig: (value) => (agentConfig = value),
        streamOptions: (value) => (streamOptions = value),
        servers: (value) => (servers = value),
      }),
      session: {
        instructions: "Use the browser.",
        maxSteps: 7,
        mcpServers: { stagehand: { command: "node" } },
        tools: { local: { id: "local" } },
      },
    });
    expect(agentConfig).toMatchObject({
      model: "anthropic/claude-sonnet-4-6",
      instructions: "Use the browser.",
      tools: { stagehand_run: { id: "run" }, local: { id: "local" } },
    });
    expect(streamOptions).toMatchObject({ maxSteps: 7 });
    expect(streamOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(servers?.stagehand).toMatchObject({ command: "node", onToolError: "return" });
  });

  it("collects final text after the last tool call and finish usage", async () => {
    const result = await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({
        events: [
          { type: "text-delta", payload: { text: "planning" } },
          {
            type: "tool-call",
            payload: { toolCallId: "1", toolName: "stagehand_run", args: {} },
          },
          { type: "text-delta", payload: { text: "final " } },
          { type: "text-delta", payload: { text: "answer" } },
          { type: "step-finish", payload: { output: { usage: {} } } },
          {
            type: "finish",
            payload: {
              stepResult: { reason: "stop" },
              output: {
                usage: {
                  inputTokens: 100,
                  outputTokens: 25,
                  reasoningTokens: 5,
                  cachedInputTokens: 10,
                },
              },
            },
          },
        ],
      }),
      session: {},
    });
    expect(result.events).toHaveLength(6);
    expect(result.finalText).toBe("final answer");
    expect(result.finishReason).toBe("stop");
    expect(result.stepCount).toBe(1);
    expect(result.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      reasoningTokens: 5,
      cachedInputTokens: 10,
      totalTokens: 125,
    });
  });

  it("notifies for tool results and tool errors", async () => {
    const observed: string[] = [];
    await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({
        events: [
          { type: "tool-result", payload: { toolName: "one", result: "ok" } },
          { type: "tool-error", payload: { toolName: "two", error: "no" } },
        ],
      }),
      session: {},
      onToolResult: (name) => {
        observed.push(name);
      },
    });
    expect(observed).toEqual(["one", "two"]);
  });

  it("returns discovery errors and disconnects without creating an agent", async () => {
    const disconnect = vi.fn();
    const createAgent = vi.fn();
    const result = await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({
        discoveryErrors: { stagehand: "not found" },
        disconnect,
        createAgent,
      }),
      session: { mcpServers: { stagehand: { command: "node" } } },
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("stagehand");
    expect(result.events).toEqual([]);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("reports stream exceptions and still disconnects", async () => {
    const disconnect = vi.fn();
    const result = await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({ streamError: new Error("stream failed"), disconnect }),
      session: { mcpServers: { stagehand: { command: "node" } } },
    });
    expect(result.status).toBe("sdk_error");
    expect(String(result.iterationError)).toContain("stream failed");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("maps a tool-calls finish reason to max_turns", async () => {
    const result = await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({
        events: [
          {
            type: "finish",
            payload: { stepResult: { reason: "tool-calls" }, output: { usage: {} } },
          },
        ],
      }),
      session: {},
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toContain("step budget exhausted");
  });

  it("sanitizes error chunks", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const result = await runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      sdk: fakeSdk({
        events: [{ type: "error", payload: { error: `bad key ${secret}` } }],
      }),
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).not.toContain(secret);
  });

  it("forwards external aborts", async () => {
    const caller = new AbortController();
    let streamSignal: AbortSignal | undefined;
    const pending = runMastraSession({
      prompt: "task",
      model: "gpt-5.4-mini",
      logger,
      signal: caller.signal,
      sdk: fakeSdk({
        streamOptions: (options) => (streamSignal = options?.abortSignal as AbortSignal),
      }),
      session: {},
    });
    caller.abort("stop");
    await pending;
    expect(streamSignal?.aborted).toBe(true);
  });
});
