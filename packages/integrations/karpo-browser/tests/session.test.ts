import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { DeepagentsProcessSpawner } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import { KARPO_BROWSER_HARNESS, runKarpoBrowserSession } from "../src/index.js";

function fakeSpawner(lines: string[]) {
  let spec: Parameters<DeepagentsProcessSpawner>[0] | undefined;
  let stdin = "";
  const spawn: DeepagentsProcessSpawner = (given) => {
    spec = given;
    const input = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    input.on("data", (chunk) => (stdin += chunk.toString()));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        queueMicrotask(() => {
          for (const line of lines) stdout.write(`${line}\n`);
          stdout.end();
          stderr.end();
          resolve({ code: 0, signal: null });
        });
      },
    );
    return { stdin: input, stdout, stderr, exited, kill: () => undefined };
  };
  return { spawn, getSpec: () => spec, getStdin: () => stdin };
}

const session = {
  agentPath: "/opt/karpo-browser/evals/stagehand/agent.sh",
  cwd: "/tmp/row",
  env: { BROWSERBASE_SESSION_ID: "session-1" },
  mcpServers: { stagehand: { command: "node", args: ["relay.mjs"] } },
  systemPrompt: "policy",
  maxToolSteps: 100,
  instruction: "Find the price",
  startUrl: "https://example.com",
  runSeconds: 2400,
  recordsDir: "/tmp/row/agent-records",
};

const terminalEvents = [
  JSON.stringify({ type: "final", text: 'EVAL_RESULT: {"success": true}' }),
  JSON.stringify({ type: "usage", input_tokens: 0, output_tokens: 0, reported: false }),
];

describe("karpo-browser session", () => {
  it("starts the agent with the task on stdin", async () => {
    const fake = fakeSpawner([
      JSON.stringify({ type: "assistant", text: "Opening the start page" }),
      ...terminalEvents,
    ]);
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const result = await runKarpoBrowserSession({
      prompt: "task prompt",
      model: "karpo-browser/controller",
      logger,
      spawn: fake.spawn,
      session,
    });

    expect(fake.getSpec()).toEqual({
      command: session.agentPath,
      args: [],
      cwd: session.cwd,
      env: session.env,
    });
    expect(JSON.parse(fake.getStdin())).toEqual({
      prompt: "task prompt",
      system_prompt: "policy",
      model: "karpo-browser/controller",
      reasoning_summary: null,
      mcp_servers: session.mcpServers,
      recursion_limit: 100,
      max_tool_steps: 100,
      result_schema: null,
      instruction: "Find the price",
      start_url: "https://example.com",
      run_seconds: 2400,
      records_dir: "/tmp/row/agent-records",
    });
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe('EVAL_RESULT: {"success": true}');
    expect(logger.log).toHaveBeenCalled();
    expect(logger.log.mock.calls.every(([entry]) => entry.category === KARPO_BROWSER_HARNESS)).toBe(
      true,
    );
  });

  it("sends a null records directory when none is given", async () => {
    const fake = fakeSpawner(terminalEvents);
    const { recordsDir: _recordsDir, ...withoutRecords } = session;
    await runKarpoBrowserSession({
      prompt: "task prompt",
      model: "karpo-browser/controller",
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      spawn: fake.spawn,
      session: withoutRecords,
    });
    expect(JSON.parse(fake.getStdin()).records_dir).toBeNull();
  });

  it("reports the agent's tool-call budget stop as max_turns", async () => {
    const fake = fakeSpawner([
      JSON.stringify({ type: "error", kind: "tool_step_budget", message: "budget reached" }),
      ...terminalEvents,
    ]);
    const result = await runKarpoBrowserSession({
      prompt: "task prompt",
      model: "karpo-browser/controller",
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      spawn: fake.spawn,
      session,
    });
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toBe("budget reached");
  });
});
