import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const makeTempDir = async (): Promise<string> =>
  fs.promises.mkdtemp(path.join(os.tmpdir(), "flow-logger-stderr-"));

afterEach(async () => {
  delete process.env.BROWSERBASE_CONFIG_DIR;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("flow logger stderr mirroring", () => {
  it("mirrors non-CDP flow logs to stderr when verbose is 3", async () => {
    const dir = await makeTempDir();
    process.env.BROWSERBASE_CONFIG_DIR = dir;

    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrChunks.push(
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString("utf-8"),
      );
      return true;
    }) as never);

    const { SessionFileLogger } = await import("../../lib/v3/flowLogger.js");

    SessionFileLogger.init("test-session-verbose-3", {
      env: "LOCAL",
      verbose: 3,
    });
    const ctx = SessionFileLogger.getContext();
    await ctx?.initPromise;

    SessionFileLogger.logAgentTaskStarted({
      invocation: "Agent.execute",
      args: ["test"],
    });
    SessionFileLogger.logStagehandStepEvent({
      invocation: "act",
      label: "ACT",
      args: ["click button"],
    });
    SessionFileLogger.logStagehandStepCompleted();
    SessionFileLogger.logLlmRequest({
      requestId: "req-1",
      model: "openai/gpt-4.1",
      operation: "generateText",
      prompt: "user: click submit",
    });
    SessionFileLogger.logLlmResponse({
      requestId: "req-1",
      model: "openai/gpt-4.1",
      operation: "generateText",
      output: "done",
      inputTokens: 10,
      outputTokens: 3,
    });
    SessionFileLogger.logCdpCallEvent({
      method: "Runtime.evaluate",
      params: { expression: "1+1" },
    });
    SessionFileLogger.logAgentTaskCompleted();
    await SessionFileLogger.close();

    const stderrOutput = stderrChunks.join("");
    expect(stderrOutput).toContain('"category":"AgentTask"');
    expect(stderrOutput).toContain('"category":"StagehandStep"');
    expect(stderrOutput).toContain('"category":"LLM"');
    expect(stderrOutput).not.toContain('"category":"CDP"');

    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("does not mirror flow logs to stderr when verbose is 2", async () => {
    const dir = await makeTempDir();
    process.env.BROWSERBASE_CONFIG_DIR = dir;

    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderrChunks.push(
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString("utf-8"),
      );
      return true;
    }) as never);

    const { SessionFileLogger } = await import("../../lib/v3/flowLogger.js");

    SessionFileLogger.init("test-session-verbose-2", {
      env: "LOCAL",
      verbose: 2,
    });
    const ctx = SessionFileLogger.getContext();
    await ctx?.initPromise;

    SessionFileLogger.logAgentTaskStarted({
      invocation: "Agent.execute",
      args: ["test"],
    });
    SessionFileLogger.logAgentTaskCompleted();
    await SessionFileLogger.close();

    expect(stderrChunks.join("")).toBe("");

    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
