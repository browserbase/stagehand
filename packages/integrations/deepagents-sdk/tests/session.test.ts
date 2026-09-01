import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeepagentsRunnerArgs,
  buildDeepagentsTranscript,
  normalizeDeepagentsModel,
  runDeepagentsSession,
  type DeepagentsProcessSpawner,
} from "../src/index.js";

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeSpawner(options: {
  lines?: string[];
  stderrLines?: string[];
  code?: number | null;
  signal?: NodeJS.Signals | null;
  onKill?: (signal?: NodeJS.Signals) => void;
}) {
  let capturedSpec: Parameters<DeepagentsProcessSpawner>[0] | undefined;
  let stdin = "";
  const spawn: DeepagentsProcessSpawner = (spec) => {
    capturedSpec = spec;
    const input = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    input.on("data", (chunk) => (stdin += chunk.toString()));
    let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        resolveExit = resolve;
      },
    );
    queueMicrotask(() => {
      for (const line of options.lines ?? []) stdout.write(`${line}\n`);
      stdout.end();
      for (const line of options.stderrLines ?? []) stderr.write(`${line}\n`);
      stderr.end();
      resolveExit({
        code: options.code === undefined ? 0 : options.code,
        signal: options.signal ?? null,
      });
    });
    return {
      stdin: input,
      stdout,
      stderr,
      exited,
      kill: (signal) => options.onKill?.(signal),
    };
  };
  return { spawn, getSpec: () => capturedSpec, getStdin: () => stdin };
}

describe("Deep Agents session", () => {
  it("forwards config and collects events, result, usage, and tool notifications", async () => {
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({ type: "assistant", text: "working" }),
        JSON.stringify({ type: "tool_result", name: "run", server: "stagehand", ok: true }),
        JSON.stringify({ type: "final", text: "complete" }),
        JSON.stringify({
          type: "usage",
          input_tokens: 10,
          output_tokens: 4,
          cache_read_input_tokens: 3,
          reasoning_output_tokens: 2,
          total_tokens: 14,
        }),
      ],
    });
    const onToolResult = vi.fn();
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "openai/gpt-5.4-mini",
      logger,
      spawn: fake.spawn,
      session: {
        runnerDir: "/tmp/runner",
        mcpServers: { stagehand: { command: "node", args: ["server.js"] } },
        recursionLimit: 80,
        maxToolSteps: 12,
      },
      onToolResult,
    });

    expect(fake.getSpec()).toMatchObject({
      command: "uv",
      args: buildDeepagentsRunnerArgs("/tmp/runner"),
    });
    expect(JSON.parse(fake.getStdin())).toMatchObject({
      prompt: "task",
      model: "openai:gpt-5.4-mini",
      mcp_servers: { stagehand: { command: "node", args: ["server.js"] } },
      recursion_limit: 80,
      max_tool_steps: 12,
    });
    expect(result.events).toHaveLength(4);
    expect(result.finalMessage).toBe("complete");
    expect(result.status).toBe("completed");
    expect(result.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 3,
      reasoningOutputTokens: 2,
      totalTokens: 14,
    });
    expect(onToolResult).toHaveBeenCalledWith("run", "stagehand");
  });

  it("maps recursion errors to max_turns", async () => {
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({ type: "error", kind: "recursion_limit", message: "limit hit" }),
        JSON.stringify({ type: "final", text: "" }),
        JSON.stringify({ type: "usage" }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe("limit hit");
  });

  it("maps tool-step budget errors to max_turns", async () => {
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({ type: "error", kind: "tool_step_budget", message: "budget hit" }),
        JSON.stringify({ type: "final", text: "" }),
        JSON.stringify({ type: "usage" }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.status).toBe("max_turns");
  });

  it("reports a non-zero exit without an error event", async () => {
    const fake = fakeSpawner({ code: 1 });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("exited with code 1");
  });

  it("reports signal termination as an SDK error", async () => {
    const fake = fakeSpawner({ code: null, signal: "SIGTERM" });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("SIGTERM");
  });

  it("redacts secrets in event errors", async () => {
    const secret = "sk-abcdef1234567890";
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({
          type: "error",
          kind: "exception",
          message: `failed with ${secret}`,
          detail: { nested: [`payload ${secret}`] },
        }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.stopReason).not.toContain("1234567890");
    expect(result.stopReason).toContain("[redacted]");
    expect(JSON.stringify(result.events)).not.toContain(secret);
    expect(result.events[0]).toMatchObject({
      message: "failed with sk-abcdef[redacted]",
      detail: { nested: ["payload sk-abcdef[redacted]"] },
    });
  });

  it("redacts secrets in failed tool results", async () => {
    const secret = "sk-abcdef1234567890";
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({
          type: "tool_result",
          name: "run",
          ok: false,
          text: `failed with ${secret}`,
        }),
        JSON.stringify({ type: "final", text: "done" }),
        JSON.stringify({ type: "usage" }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });

    expect(JSON.stringify(result.events)).toContain("sk-abcdef[redacted]");
    expect(JSON.stringify(result.events)).not.toContain(secret);
  });

  it("deep-redacts events carrying error text even when their type is not error", async () => {
    const secret = "bb_live_abcd1234567890";
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({
          type: "diagnostic",
          detail: "request failed",
          payload: { error: `nested ${secret}`, context: [`trace ${secret}`] },
        }),
        JSON.stringify({ type: "final", text: "done" }),
        JSON.stringify({ type: "usage" }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });

    expect(JSON.stringify(result.events)).not.toContain(secret);
    expect(result.events[0]).toMatchObject({
      payload: {
        error: "nested bb_live_abcd[redacted]",
        context: ["trace bb_live_abcd[redacted]"],
      },
    });
  });

  it("forwards abort as SIGTERM", async () => {
    const killed = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const fake = fakeSpawner({ onKill: killed });
    await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      signal: controller.signal,
      spawn: fake.spawn,
      session: {},
    });
    expect(killed).toHaveBeenCalledWith("SIGTERM");
  });

  it("normalizes supported provider model prefixes", () => {
    expect(normalizeDeepagentsModel("openai/gpt-5.4-mini")).toBe("openai:gpt-5.4-mini");
    expect(normalizeDeepagentsModel("anthropic/claude")).toBe("anthropic:claude");
    expect(normalizeDeepagentsModel("google/gemini")).toBe("google_genai:gemini");
    expect(normalizeDeepagentsModel("openai:gpt-5.4-mini")).toBe("openai:gpt-5.4-mini");
    expect(normalizeDeepagentsModel("bare-model")).toBe("bare-model");
  });

  it("ignores non-JSON stdout lines", async () => {
    const fake = fakeSpawner({
      lines: [
        "debug output",
        JSON.stringify({ type: "final", text: "ok" }),
        JSON.stringify({ type: "usage" }),
      ],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.events).toHaveLength(2);
    expect(result.finalMessage).toBe("ok");
  });

  it("redacts stderr, non-JSON stdout, and assistant event logs", async () => {
    logger.log.mockClear();
    const secret = "sk-abcdef1234567890";
    const fake = fakeSpawner({
      lines: [
        `debug ${secret}`,
        JSON.stringify({ type: "assistant", text: `assistant ${secret}` }),
        JSON.stringify({ type: "final", text: "ok" }),
        JSON.stringify({ type: "usage" }),
      ],
      stderrLines: [`stderr ${secret}`],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    const logged = JSON.stringify(logger.log.mock.calls);
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(secret);
    expect(buildDeepagentsTranscript(result.events)).not.toContain(secret);
    expect(result.status).toBe("completed");
  });

  it("sanitizes a full non-JSON line before clipping it", async () => {
    logger.log.mockClear();
    const secret = `AIza${"A".repeat(30)}`;
    const fake = fakeSpawner({
      lines: [
        `${"x".repeat(479)} ${secret}`,
        JSON.stringify({ type: "final", text: "ok" }),
        JSON.stringify({ type: "usage" }),
      ],
    });

    await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });

    const logged = JSON.stringify(logger.log.mock.calls);
    expect(logged).toContain("AIza[redacted]");
    expect(logged).not.toContain(secret);
  });

  it("returns a sanitized string for iterationError", async () => {
    const secret = "Bearer abcdefghijklmnop";
    const spawn: DeepagentsProcessSpawner = () => {
      throw new Error(`startup failed with ${secret}`);
    };

    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn,
      session: {},
    });

    expect(result.iterationError).toBe("startup failed with Bearer [redacted]");
    expect(typeof result.iterationError).toBe("string");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects truncated terminal output even when the runner exits zero", async () => {
    const fake = fakeSpawner({ lines: ['{"type":"final","te'] });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toMatch(/terminal|truncated/);
  });

  it("escalates an ignored abort and bounds stream draining", async () => {
    const controller = new AbortController();
    const kills: NodeJS.Signals[] = [];
    const spawn: DeepagentsProcessSpawner = () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      stdout.end();
      let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          resolveExit = resolve;
        },
      );
      return {
        stdin,
        stdout,
        stderr,
        exited,
        kill: (signal = "SIGTERM") => {
          kills.push(signal);
          if (signal === "SIGKILL") resolveExit({ code: null, signal });
        },
      };
    };
    const resultPromise = runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      signal: controller.signal,
      spawn,
      session: { killGraceMs: 10, streamDrainMs: 10 },
    });
    controller.abort();
    const result = await resultPromise;
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("SIGKILL");
  });
});
