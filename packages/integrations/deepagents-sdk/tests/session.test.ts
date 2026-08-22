import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeepagentsRunnerArgs,
  normalizeDeepagentsModel,
  runDeepagentsSession,
  type DeepagentsProcessSpawner,
} from "../src/index.js";

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeSpawner(options: {
  lines?: string[];
  code?: number;
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
      stderr.end();
      resolveExit({ code: options.code ?? 0, signal: null });
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
      lines: [JSON.stringify({ type: "error", kind: "recursion_limit", message: "limit hit" })],
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

  it("redacts secrets in event errors", async () => {
    const fake = fakeSpawner({
      lines: [
        JSON.stringify({
          type: "error",
          kind: "exception",
          message: "failed with sk-abcdef1234567890",
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
      lines: ["debug output", JSON.stringify({ type: "final", text: "ok" })],
    });
    const result = await runDeepagentsSession({
      prompt: "task",
      model: "model",
      logger,
      spawn: fake.spawn,
      session: {},
    });
    expect(result.events).toHaveLength(1);
    expect(result.finalMessage).toBe("ok");
  });
});
