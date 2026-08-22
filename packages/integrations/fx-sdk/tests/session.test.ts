import { describe, expect, it, vi } from "vitest";
import {
  normalizeFxModel,
  runFxSession,
  type FxProcessRunner,
  type FxSessionStore,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function jsonl(...events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function committedEvent(terminalReason = "completed") {
  return {
    kind: "history_turn_committed",
    payload: {
      total_input_tokens: 11,
      total_output_tokens: 4,
      turn: {
        kind: "completed",
        assistant: "turn answer",
        terminal_reason: terminalReason,
        execution: {
          schema_version: 3,
          tool_steps: [
            {
              assistant: "I will inspect the page.",
              tool_calls: [
                {
                  id: "call-1",
                  name: "mcp_stagehand_snapshot",
                  arguments_json: "{}",
                  provider_result: null,
                },
              ],
              tool_results: [
                {
                  tool_call_id: "call-1",
                  tool_name: "mcp_stagehand_snapshot",
                  status: "success",
                  output: "snapshot",
                  truncated: false,
                },
              ],
            },
          ],
        },
      },
    },
  };
}

function fakeStore(events: string, usage?: Record<string, unknown>): FxSessionStore {
  return {
    waitForSessionDir: async () => "/fake/session",
    readEventsJsonl: async () => events,
    readUsageSnapshot: async () => usage,
  };
}

describe("fx CLI session", () => {
  it("runs ask through stdin and reconstructs the committed turn", async () => {
    let captured: Parameters<FxProcessRunner>[0] | undefined;
    const runProcess: FxProcessRunner = async (input) => {
      captured = input;
      return {
        stdout: JSON.stringify({
          output: '{"success":true,"summary":"done","finalAnswer":"ok"}',
          exit_code: 0,
          session_id: "session-1",
        }),
        stderr: "progress",
        exitCode: 0,
      };
    };
    const result = await runFxSession({
      prompt: "do the task",
      model: "openai/gpt-5.6-sol",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: { PATH: "/bin" },
      maxAgentSteps: 17,
      logger,
      runProcess,
      store: fakeStore(jsonl(committedEvent()), {
        snapshot: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_tokens: 30,
          reasoning_tokens: 5,
          total_cost: 0.25,
        },
      }),
    });

    expect(captured?.args).toEqual(["ask", "--json", "--auto"]);
    expect(captured?.stdin).toBe("do the task");
    expect(captured?.env).toMatchObject({
      HOME: "/fake/home",
      FX_MODEL: "openai/gpt-5.6-sol",
      FX_MAX_AGENT_STEPS: "17",
      FX_PERMISSION_MODE: "auto",
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "stderr",
      "tool_step",
      "assistant",
      "turn_committed",
      "ask_result",
    ]);
    expect(result.tokenUsage).toEqual({
      input_tokens: 100,
      cached_input_tokens: 30,
      output_tokens: 20,
      reasoning_output_tokens: 5,
      total_cost: 0.25,
    });
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toContain('"success":true');
  });

  it("reports missing credentials as an SDK error", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ error: "MissingCredentials", exit_code: 1 }),
        stderr: "",
        exitCode: 1,
      }),
      store: fakeStore(""),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("MissingCredentials");
  });

  it("maps a committed step limit to max_turns", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "stopped", exit_code: 0 }),
        stderr: "",
        exitCode: 0,
      }),
      store: fakeStore(jsonl(committedEvent("step_limit_reached"))),
    });
    expect(result.status).toBe("max_turns");
  });

  it("reports output that is not JSON", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({ stdout: "not json", stderr: "bad output", exitCode: 1 }),
      store: fakeStore(""),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("fx produced no JSON output");
  });

  it("deduplicates observed MCP tool calls and ignores built-in tools", async () => {
    const onToolStep = vi.fn();
    const recovery = {
      kind: "recovery_checkpoint_set",
      payload: {
        checkpoint: {
          execution: {
            tool_steps: [
              {
                assistant: "inspect",
                tool_calls: [
                  { id: "call-1", name: "mcp_stagehand_snapshot", arguments_json: "{}" },
                  { id: "call-2", name: "read_file", arguments_json: "{}" },
                ],
                tool_results: [],
              },
            ],
          },
        },
      },
    };
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      pollIntervalMs: 1,
      onToolStep,
      runProcess: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { stdout: JSON.stringify({ output: "done" }), stderr: "", exitCode: 0 };
      },
      store: fakeStore(jsonl(recovery, committedEvent())),
    });
    expect(result.status).toBe("completed");
    expect(onToolStep).toHaveBeenCalledTimes(1);
    expect(onToolStep.mock.calls[0]?.[0]).toMatchObject({ id: "call-1" });
  });

  it("forwards aborts to the process and reports aborted", async () => {
    const controller = new AbortController();
    const runProcess: FxProcessRunner = async ({ signal }) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      expect(signal.aborted).toBe(true);
      return { stdout: "", stderr: "", exitCode: null, signal: "SIGTERM" };
    };
    const pending = runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      signal: controller.signal,
      runProcess,
      store: fakeStore(""),
    });
    controller.abort();
    const result = await pending;
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("aborted");
  });

  it("normalizes only the fx default model", () => {
    expect(normalizeFxModel("fx/default")).toBeUndefined();
    expect(normalizeFxModel("anthropic/claude-sonnet-4.5")).toBe("anthropic/claude-sonnet-4.5");
  });

  it("sanitizes stop reasons", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ error: "failed with bb_live_abcd1234567890" }),
        stderr: "",
        exitCode: 1,
      }),
      store: fakeStore(""),
    });
    expect(result.stopReason).not.toContain("1234567890");
    expect(result.stopReason).toContain("[redacted]");
  });
});
