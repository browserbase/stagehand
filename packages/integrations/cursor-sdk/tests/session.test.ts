import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessAdapterError } from "@browserbasehq/stagehand-integrations/harness";
import {
  buildCursorAgentArgs,
  extractCursorToolCall,
  normalizeCursorModel,
  parseCursorStreamLine,
  resolveCursorAgentBinary,
  runCursorAgentSession,
  type CursorProcessRunner,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };
const originalAgentPath = process.env.CURSOR_AGENT_PATH;

afterEach(() => {
  if (originalAgentPath === undefined) delete process.env.CURSOR_AGENT_PATH;
  else process.env.CURSOR_AGENT_PATH = originalAgentPath;
});

describe("Cursor CLI session", () => {
  it("builds ordered arguments and normalizes models", () => {
    const args = buildCursorAgentArgs({
      prompt: "do it",
      model: "sonnet-4",
      session: {
        cwd: "/tmp/work",
        apiKey: "key",
        sandbox: "enabled",
        extraArgs: ["--header", "X-Test: yes"],
      },
    });
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "stream-json"]);
    expect(args).toContain("--force");
    expect(args).toContain("--trust");
    expect(args).toContain("--approve-mcps");
    expect(args).toContain("--workspace");
    expect(args).toContain("--model");
    expect(args).toContain("--api-key");
    expect(args).toContain("--sandbox");
    expect(args.at(-1)).toBe("do it");

    const disabled = buildCursorAgentArgs({
      prompt: "task",
      session: { force: false, trust: false, approveMcps: false },
    });
    expect(disabled).not.toContain("--force");
    expect(disabled).not.toContain("--trust");
    expect(disabled).not.toContain("--approve-mcps");
    expect(normalizeCursorModel("cursor/auto")).toBeUndefined();
    expect(normalizeCursorModel("auto")).toBeUndefined();
    expect(normalizeCursorModel("cursor/sonnet-4")).toBe("sonnet-4");
    expect(normalizeCursorModel("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(normalizeCursorModel("sonnet-4")).toBe("sonnet-4");
  });

  it("collects stream events, results, usage, and completed tool callbacks", async () => {
    const completed = vi.fn();
    const lines = [
      { type: "system", subtype: "init" },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "task" }] } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "reading" }] },
      },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: { readToolCall: { args: { path: "file.txt" } } },
      },
      {
        type: "tool_call",
        subtype: "completed",
        call_id: "c1",
        tool_call: {
          readToolCall: { args: { path: "file.txt" }, result: { success: { content: "ok" } } },
        },
      },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ];
    const result = await runCursorAgentSession({
      prompt: "task",
      model: "cursor/auto",
      logger,
      session: {},
      runProcess: scriptedRunner(lines),
      onToolResult: completed,
    });

    expect(result.status).toBe("completed");
    expect(result.resultText).toBe("done");
    expect(result.events).toHaveLength(6);
    expect(result.tokenUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reported: false,
    });
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0][0]).toBe("read");
  });

  it("parses defensive MCP and function tool-call shapes", () => {
    const mcp = extractCursorToolCall({
      type: "tool_call",
      subtype: "completed",
      call_id: "m1",
      tool_call: {
        mcpToolCall: {
          args: { providerIdentifier: "stagehand", name: "run", args: { code: "return 1" } },
          result: { success: { content: [] } },
        },
      },
    });
    expect(mcp).toMatchObject({ name: "stagehand.run", args: { code: "return 1" } });

    const fn = extractCursorToolCall({
      type: "tool_call",
      subtype: "completed",
      call_id: "f1",
      tool_call: {
        function: {
          name: "custom_tool",
          arguments: '{"value":2}',
          result: { success: "ok" },
        },
      },
    });
    expect(fn).toMatchObject({ name: "custom_tool", args: { value: 2 } });
  });

  it("ignores blank and non-JSON output", () => {
    expect(parseCursorStreamLine("  ")).toBeUndefined();
    expect(parseCursorStreamLine("Cursor Agent v1")).toBeUndefined();
    expect(parseCursorStreamLine('{"type":"system"}')).toEqual({ type: "system" });
  });

  it("classifies and sanitizes result and process failures", async () => {
    const errorResult = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: scriptedRunner([
        {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "failed with sk-abcdef1234567890",
        },
      ]),
    });
    expect(errorResult.status).toBe("sdk_error");
    expect(errorResult.stopReason).toContain("sk-abcdef[redacted]");

    const exitResult = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: scriptedRunner([], {
        exitCode: 2,
        stderr: "bb_live_abcdefghi https://x.test?apiKey=secret-value\n",
      }),
    });
    expect(exitResult.status).toBe("sdk_error");
    expect(exitResult.stopReason).toContain("exited with code 2");
    expect(exitResult.stopReason).toContain("bb_live_abcd[redacted]");
    expect(exitResult.stopReason).toContain("apiKey=[redacted]");
    expect(exitResult.stopReason).not.toContain("secret-value");
    expect(exitResult.stderr).not.toContain("secret-value");
  });

  it("sanitizes stored event payloads and typed process errors", async () => {
    const secret = "sk-abcdef1234567890";
    const eventResult = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: scriptedRunner([
        {
          type: "tool_call",
          subtype: "completed",
          call_id: "1",
          tool_call: {
            readToolCall: { args: {}, result: { error: `failed with ${secret}` } },
          },
        },
        { type: "result", result: "done" },
      ]),
    });
    expect(JSON.stringify(eventResult.events)).toContain("sk-abcdef[redacted]");
    expect(JSON.stringify(eventResult.events)).not.toContain(secret);

    const processResult = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: async () => {
        throw new Error(`process failed with ${secret}`);
      },
    });
    expect(processResult.iterationError).toBeInstanceOf(HarnessAdapterError);
    expect(String(processResult.iterationError)).toContain("sk-abcdef[redacted]");
    expect(String(processResult.iterationError)).not.toContain(secret);
  });

  it("fails closed when a successful process emits no result event", async () => {
    const result = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: scriptedRunner([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "partial answer" }] },
        },
      ]),
    });

    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("Cursor agent exited without a terminal result event");
  });

  it("aborts when the completed tool-step budget is exhausted", async () => {
    let processSignal: AbortSignal | undefined;
    const runner: CursorProcessRunner = async (input) => {
      processSignal = input.signal;
      for (const callId of ["1", "2"]) {
        await input.onStdoutLine(
          JSON.stringify({
            type: "tool_call",
            subtype: "completed",
            call_id: callId,
            tool_call: { readToolCall: { args: {}, result: { success: {} } } },
          }),
        );
      }
      return { exitCode: null, signal: "SIGTERM" };
    };
    const result = await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      session: {},
      runProcess: runner,
      maxToolSteps: 1,
    });
    expect(processSignal?.aborted).toBe(true);
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe("tool step budget exhausted (1 steps)");
  });

  it("removes the caller abort forwarder after completion", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (type: string) => added.push(type),
      removeEventListener: (type: string) => removed.push(type),
    } as unknown as AbortSignal;
    await runCursorAgentSession({
      prompt: "task",
      model: "auto",
      logger,
      signal,
      session: {},
      runProcess: scriptedRunner([{ type: "result", result: "done" }]),
    });
    expect(added).toEqual(["abort"]);
    expect(removed).toEqual(["abort"]);
  });

  it("resolves the binary override before environment and default", () => {
    process.env.CURSOR_AGENT_PATH = "/env/agent";
    expect(resolveCursorAgentBinary("/override/agent")).toBe("/override/agent");
    expect(resolveCursorAgentBinary()).toBe("/env/agent");
    delete process.env.CURSOR_AGENT_PATH;
    expect(resolveCursorAgentBinary()).toBe("agent");
  });
});

function scriptedRunner(
  events: Array<Record<string, unknown>>,
  options: { exitCode?: number; stderr?: string } = {},
): CursorProcessRunner {
  return async (input) => {
    input.onStderr(options.stderr ?? "");
    await input.onStdoutLine("Cursor banner");
    await input.onStdoutLine(" ");
    for (const event of events) await input.onStdoutLine(JSON.stringify(event));
    return { exitCode: options.exitCode ?? 0, signal: null };
  };
}
