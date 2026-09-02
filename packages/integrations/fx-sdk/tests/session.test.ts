import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { HarnessAdapterError } from "@browserbasehq/stagehand-integrations/harness";
import {
  buildFxTranscript,
  createFxProcessRunner,
  normalizeFxModel,
  resolveFxStatus,
  runFxSession,
  summarizeFxEvent,
  type FxProcessRunner,
  type FxSessionStore,
  type FxToolCallRecord,
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
    expect(result.observedToolCallKeys).toEqual([]);
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
    expect(result.iterationError).toBeInstanceOf(HarnessAdapterError);
  });

  it("clamps fractional step budgets to one", async () => {
    let capturedEnv: Record<string, string> | undefined;
    await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      maxAgentSteps: 0.5,
      logger,
      runProcess: async ({ env }) => {
        capturedEnv = env;
        return {
          stdout: JSON.stringify({ output: "done", exit_code: 0 }),
          stderr: "",
          exitCode: 0,
        };
      },
      store: fakeStore(""),
    });

    expect(capturedEnv?.FX_MAX_AGENT_STEPS).toBe("1");
  });

  it("maps a committed step limit to max_turns", async () => {
    const notice = "Agent step limit reached; continue with a follow-up prompt if needed.";
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: notice, exit_code: 1 }),
        stderr: "",
        exitCode: 1,
      }),
      store: fakeStore(
        jsonl({
          kind: "history_turn_committed",
          payload: { turn: { kind: "assistant", assistant: notice } },
        }),
      ),
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe(notice);
  });

  it("does not fabricate a budget failure for a clean run at exactly the step budget", () => {
    expect(
      resolveFxStatus({
        exitCode: 0,
        signal: null,
        ask: { output: "done", exit_code: 0 },
        terminalReason: "completed",
        observedToolSteps: 5,
        maxAgentSteps: 5,
      }),
    ).toEqual({ status: "completed" });
  });

  it("maps the configured observed step count to max_turns", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      maxAgentSteps: 1,
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "stopped", exit_code: 1 }),
        stderr: "",
        exitCode: 1,
      }),
      store: fakeStore(jsonl(committedEvent())),
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toContain("1 steps");
  });

  it("tracks spawned process groups for abort and process shutdown", async () => {
    const hooks = new EventEmitter();
    const killProcess = vi.fn(() => true);
    const children: ChildProcess[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 4321 + children.length,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        kill: vi.fn(() => true),
      });
      children.push(child);
      return child;
    });
    const runner = createFxProcessRunner({
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
      killProcess: killProcess as unknown as typeof process.kill,
      processHooks: hooks as unknown as Pick<NodeJS.Process, "on">,
      killGraceMs: 1,
    });
    const run = (signal: AbortSignal) =>
      runner({
        bin: "fx",
        args: ["ask"],
        cwd: "/fake",
        env: {},
        stdin: "task",
        signal,
      });

    const first = run(new AbortController().signal);
    expect(hooks.listenerCount("exit")).toBe(1);
    hooks.emit("exit", 0);
    expect(killProcess).toHaveBeenCalledWith(-4321, "SIGTERM");
    expect(killProcess).toHaveBeenCalledWith(-4321, "SIGKILL");
    children[0]?.emit("close", 0, null);
    await first;
    killProcess.mockClear();
    hooks.emit("exit", 0);
    expect(killProcess).not.toHaveBeenCalled();

    const controller = new AbortController();
    const second = run(controller.signal);
    expect(hooks.listenerCount("exit")).toBe(1);
    controller.abort();
    expect(killProcess).toHaveBeenCalledWith(-4322, "SIGTERM");
    children[1]?.emit("close", null, "SIGTERM");
    await second;
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

  it("records only MCP tool calls observed from a live recovery checkpoint", async () => {
    let releaseProcess: (() => void) | undefined;
    const polled = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    const onToolStep = vi.fn((_call: FxToolCallRecord) => releaseProcess?.());
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
    const committed = committedEvent();
    committed.payload.turn.execution.tool_steps[0]?.tool_calls.push({
      id: "call-2",
      name: "mcp_stagehand_run",
      arguments_json: "{}",
      provider_result: null,
    });
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      pollIntervalMs: 1,
      onToolStep,
      runProcess: async () => {
        await polled;
        return { stdout: JSON.stringify({ output: "done" }), stderr: "", exitCode: 0 };
      },
      store: {
        waitForSessionDir: async () => "/fake/session",
        readEventsJsonl: async () => "",
        readEventsJsonlChunk: vi.fn(async (_sessionDir, offset) => {
          const text = offset === 0 ? `${jsonl(recovery)}\n` : jsonl(committed);
          return { text, nextOffset: offset + Buffer.byteLength(text) };
        }),
      },
    });
    expect(result.status).toBe("completed");
    expect(onToolStep).toHaveBeenCalledTimes(1);
    expect(onToolStep.mock.calls[0]?.[0]).toMatchObject({ id: "call-1" });
    expect(result.observedToolCallKeys).toEqual(["call-1"]);
  });

  it("does not synthesize observations from a committed turn after exit", async () => {
    const onToolStep = vi.fn();
    let processExited = false;
    let releaseProcess: (() => void) | undefined;
    const polled = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    const committed = committedEvent();
    const toolCalls = committed.payload.turn.execution.tool_steps[0]?.tool_calls;
    toolCalls?.push(
      { id: "call-2", name: "mcp_stagehand_run", arguments_json: "{}", provider_result: null },
      {
        id: "call-3",
        name: "mcp_stagehand_screenshot",
        arguments_json: "{}",
        provider_result: null,
      },
    );
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      pollIntervalMs: 1,
      onToolStep,
      runProcess: async () => {
        await polled;
        processExited = true;
        return { stdout: JSON.stringify({ output: "done" }), stderr: "", exitCode: 0 };
      },
      store: {
        waitForSessionDir: async () => "/fake/session",
        readEventsJsonl: async () => {
          releaseProcess?.();
          return processExited ? jsonl(committed) : "";
        },
      },
    });
    expect(onToolStep).not.toHaveBeenCalled();
    expect(result.observedToolCallKeys).toEqual([]);
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

  it("sanitizes complete stderr and assistant text before clipping", async () => {
    const boundarySecret = `${"x".repeat(490)} sk-abcdef1234567890`;
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({ stdout: "", stderr: boundarySecret, exitCode: 1 }),
      store: fakeStore(""),
    });

    expect(result.stopReason).not.toContain("sk-abcdef1");
    expect(result.stopReason).not.toContain("1234567890");
    expect(summarizeFxEvent({ type: "assistant", text: boundarySecret }).message).not.toContain(
      "sk-abcdef1",
    );
  });

  it("treats successful exits without JSON output as SDK errors", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      store: fakeStore(""),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("no JSON output");
  });

  it("honors fx ask exit codes even when the process exits zero", async () => {
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "x", exit_code: 2 }),
        stderr: "",
        exitCode: 0,
      }),
      store: fakeStore(""),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("exit_code 2");
  });

  it("honors failed committed turn reasons even when the process exits zero", async () => {
    const committed = committedEvent("cancelled");
    committed.payload.turn.kind = "interrupted";
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger,
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "x", exit_code: 0 }),
        stderr: "",
        exitCode: 0,
      }),
      store: fakeStore(jsonl(committed)),
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("cancelled");
  });

  it("redacts sensitive event details in logs and transcripts", async () => {
    const log = vi.fn();
    const secretEvent = committedEvent();
    const resultRecord = secretEvent.payload.turn.execution.tool_steps[0]?.tool_results[0];
    if (resultRecord) resultRecord.output = "token bb_live_abcd1234567890";
    const result = await runFxSession({
      prompt: "task",
      cwd: "/fake/workspace",
      home: "/fake/home",
      env: {},
      logger: { log, warn: () => {}, error: () => {} },
      runProcess: async () => ({
        stdout: JSON.stringify({ output: "done", exit_code: 0 }),
        stderr: "",
        exitCode: 0,
      }),
      store: fakeStore(jsonl(secretEvent)),
    });
    const details = log.mock.calls
      .map((call) => call[0]?.auxiliary?.detail?.value)
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    expect(details).toContain("[redacted]");
    expect(details).not.toContain("1234567890");
    expect(buildFxTranscript(result.events)).toContain("[redacted]");
    expect(buildFxTranscript(result.events)).not.toContain("1234567890");
  });
});
