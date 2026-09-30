import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  MASTRACODE_PROTOCOL_VERSION,
  buildMastracodeTranscript,
  createMastracodeProcessRunner,
  parseDriverEventLine,
  resolveMastracodeDriverPath,
  runMastracodeSession,
  toolNamesFor,
  type MastracodeDriverRequest,
  type MastracodeProcessRunner,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureLines = fs
  .readFileSync(path.join(here, "fixtures/events.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim());

const request: MastracodeDriverRequest = {
  version: MASTRACODE_PROTOCOL_VERSION,
  prompt: "task",
  hostInstructions: "policy",
  modelId: "anthropic/claude-sonnet-4-6",
  stepBudget: 10,
  mcpServers: { stagehand: { command: "node", args: ["bridge.mjs"] } },
  facadeToolNames: toolNamesFor(),
  workspaceDir: "/tmp/ws",
  appDataDir: "/tmp/app",
  homeDir: "/tmp/home",
};

function stubRunner(
  lines: string[],
  output: { exitCode?: number | null; signal?: string | null; stderr?: string } = {},
): { runProcess: MastracodeProcessRunner; calls: Parameters<MastracodeProcessRunner>[0][] } {
  const calls: Parameters<MastracodeProcessRunner>[0][] = [];
  return {
    calls,
    runProcess: async (input) => {
      calls.push(input);
      for (const line of lines) input.onStdoutLine(line);
      return {
        exitCode: output.exitCode === undefined ? 0 : output.exitCode,
        signal: output.signal,
        stderr: output.stderr ?? "",
      };
    },
  };
}

const ev = (event: Record<string, unknown>) =>
  JSON.stringify({ v: MASTRACODE_PROTOCOL_VERSION, ...event });

const done = (fields: Record<string, unknown>) =>
  ev({ type: "done", finalText: "", steps: 0, ...fields });

describe("runMastracodeSession", () => {
  it("spawns the driver with the request on stdin and folds a completed run", async () => {
    const { runProcess, calls } = stubRunner(fixtureLines);
    const seen: string[] = [];
    const result = await runMastracodeSession({
      request,
      cwd: "/tmp/ws",
      env: { PATH: "/bin" },
      runProcess,
      driverPath: "/opt/driver.mjs",
      onEvent: (event) => seen.push(event.type),
    });

    expect(calls[0]?.bin).toBe(process.execPath);
    expect(calls[0]?.args).toEqual(["/opt/driver.mjs"]);
    expect(JSON.parse(calls[0]?.stdin ?? "")).toEqual(request);
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe('{"success":true,"summary":"done","finalAnswer":"42"}');
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(result.ready?.mastracodeVersion).toBe("0.41.0");
    expect(result.requests.map((entry) => entry.cacheBreakpoints)).toEqual([2, 2, 2]);
    expect(result.usage).toEqual({
      promptTokens: 12_980,
      completionTokens: 70,
      totalTokens: 13_050,
      cachedInputTokens: 8_300,
      cacheCreationInputTokens: 4_500,
    });
    expect(result.responseUsage.agent).toMatchObject({
      requests: 3,
      inputTokens: 12_980,
      cachedInputTokens: 8_300,
      cacheCreationInputTokens: 4_500,
      outputTokens: 70,
    });
    expect(result.responseUsage.side).toBeUndefined();
    expect(seen).toContain("tool_end");
  });

  it("keeps usage from step events when the driver dies before done", async () => {
    const withoutDone = fixtureLines.filter((line) => !line.includes('"type":"done"'));
    const { runProcess } = stubRunner(withoutDone, {
      exitCode: null,
      signal: "SIGKILL",
      stderr: "boot ok\nFATAL heap out of memory",
    });
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe(
      "driver_exited_without_result (signal SIGKILL): FATAL heap out of memory",
    );
    expect(result.iterationError).toContain("signal SIGKILL");
    expect(result.iterationError).toContain("FATAL heap out of memory");
    expect(result.usage?.promptTokens).toBe(12_980);
    expect(result.steps).toBe(3);
    // Without a done event the last step's text is still the final message.
    expect(result.finalText).toContain('"finalAnswer":"42"');
  });

  it("does not trust a completed done event from a process that exited non-zero", async () => {
    const { runProcess } = stubRunner([done({ status: "completed", finalText: "x" })], {
      exitCode: 3,
    });
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe("sdk_error");
    expect(result.iterationError).toContain("code 3");
  });

  it("maps a tool-isolation violation to sdk_error regardless of the done status", async () => {
    const { runProcess } = stubRunner([
      ev({ type: "violation", kind: "unexpected_tool", names: ["web_search", "execute_command"] }),
      done({ status: "completed", finalText: '{"success":true}' }),
    ]);
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("tool_isolation_violation");
    expect(result.iterationError).toContain("web_search, execute_command");
  });

  it.each([
    ["max_turns", "max_turns", "max_steps"],
    ["timeout", "sdk_error", "timeout"],
    ["aborted", "sdk_error", "aborted"],
  ] as const)("maps done status %s", async (status, expected, stopReason) => {
    const { runProcess } = stubRunner([done({ status })]);
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe(expected);
    expect(result.stopReason).toBe(stopReason);
  });

  it("surfaces the driver's error as the stop reason", async () => {
    const { runProcess } = stubRunner([
      done({ status: "error", stopReason: "mcp_unavailable", error: "MCP tools missing" }),
    ]);
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("mcp_unavailable");
    expect(result.iterationError).toBe("MCP tools missing");
  });

  it("records a parent abort as aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { runProcess, calls } = stubRunner([done({ status: "aborted" })], { exitCode: 143 });
    const result = await runMastracodeSession({
      request,
      cwd: "/",
      env: {},
      runProcess,
      signal: controller.signal,
    });
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("aborted");
  });

  it("kills the driver at the hard wall-clock limit", async () => {
    const runProcess: MastracodeProcessRunner = (input) =>
      new Promise((resolve) => {
        input.signal.addEventListener("abort", () =>
          resolve({ exitCode: null, signal: "SIGTERM", stderr: "" }),
        );
      });
    const result = await runMastracodeSession({
      request,
      cwd: "/",
      env: {},
      runProcess,
      killAfterMs: 5,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toBe("timeout");
  });

  it("routes non-protocol stdout lines to the stderr observer", async () => {
    const { runProcess } = stubRunner(["some library banner", done({ status: "completed" })]);
    const stderr: string[] = [];
    const result = await runMastracodeSession({
      request,
      cwd: "/",
      env: {},
      runProcess,
      onStderrLine: (line) => stderr.push(line),
    });
    expect(result.status).toBe("completed");
    expect(stderr).toEqual(["[stdout] some library banner"]);
  });

  it("reports a spawn failure as sdk_error", async () => {
    const runProcess: MastracodeProcessRunner = async () => {
      throw new Error("spawn ENOENT");
    };
    const result = await runMastracodeSession({ request, cwd: "/", env: {}, runProcess });
    expect(result.status).toBe("sdk_error");
    expect(result.iterationError).toContain("spawn ENOENT");
  });
});

describe("driver event lines", () => {
  it("accepts only versioned protocol objects", () => {
    expect(parseDriverEventLine(ev({ type: "ready", mcpTools: [] }))?.type).toBe("ready");
    expect(parseDriverEventLine('{"type":"ready"}')).toBeUndefined();
    expect(parseDriverEventLine("not json")).toBeUndefined();
    expect(parseDriverEventLine("{broken")).toBeUndefined();
  });

  it("builds the transcript from step text", () => {
    const events = fixtureLines.map((line) => parseDriverEventLine(line)!);
    expect(buildMastracodeTranscript(events)).toBe(
      'Checking the page.\n\nChecking the page.\n\n{"success":true,"summary":"done","finalAnswer":"42"}',
    );
  });

  it("resolves the driver next to the module unless overridden", () => {
    expect(resolveMastracodeDriverPath({})).toMatch(/driver\.mjs$/u);
    expect(resolveMastracodeDriverPath({ EVAL_MASTRACODE_DRIVER_PATH: "/x/d.mjs" })).toBe(
      "/x/d.mjs",
    );
  });
});

describe("createMastracodeProcessRunner", () => {
  function fakeSpawn() {
    const children: ChildProcess[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new EventEmitter() as unknown as ChildProcess;
      Object.assign(child, {
        pid: 7000 + children.length,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        kill: vi.fn(() => true),
      });
      children.push(child);
      return child;
    });
    return { children, spawnProcess };
  }

  it("splits stdout into lines across chunk boundaries", async () => {
    const { children, spawnProcess } = fakeSpawn();
    const runner = createMastracodeProcessRunner({
      spawnProcess: spawnProcess as never,
      processHooks: new EventEmitter() as never,
    });
    const lines: string[] = [];
    const stderrLines: string[] = [];
    const pending = runner({
      bin: "node",
      args: ["driver.mjs"],
      cwd: "/",
      env: {},
      stdin: "{}",
      signal: new AbortController().signal,
      onStdoutLine: (line) => lines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    });
    const child = children[0]!;
    const stdout = child.stdout as PassThrough;
    const stderr = child.stderr as PassThrough;
    stdout.write('{"v":1,"type":"re');
    stdout.write('ady","mcpTools":[]}\n{"v":1,');
    stdout.write('"type":"done"}');
    stderr.write("warn one\nwarn");
    stderr.write(" two\n");
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("close", 0, null);
    const output = await pending;
    expect(lines).toEqual(['{"v":1,"type":"ready","mcpTools":[]}', '{"v":1,"type":"done"}']);
    expect(stderrLines).toEqual(["warn one", "warn two"]);
    expect(output.exitCode).toBe(0);
    expect(output.stderr).toContain("warn two");
  });

  it("terminates the process group on abort and on parent exit", async () => {
    const hooks = new EventEmitter();
    const killProcess = vi.fn(() => true);
    const { children, spawnProcess } = fakeSpawn();
    const runner = createMastracodeProcessRunner({
      spawnProcess: spawnProcess as never,
      killProcess: killProcess as never,
      processHooks: hooks as never,
      killGraceMs: 1,
    });
    const run = (signal: AbortSignal) =>
      runner({
        bin: "node",
        args: [],
        cwd: "/",
        env: {},
        stdin: "{}",
        signal,
        onStdoutLine: () => undefined,
      });

    const controller = new AbortController();
    const first = run(controller.signal);
    controller.abort();
    expect(killProcess).toHaveBeenCalledWith(-7000, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(killProcess).toHaveBeenCalledWith(-7000, "SIGKILL");
    children[0]!.emit("close", null, "SIGKILL");
    await first;

    killProcess.mockClear();
    const second = run(new AbortController().signal);
    hooks.emit("exit", 0);
    expect(killProcess).toHaveBeenCalledWith(-7001, "SIGTERM");
    expect(killProcess).toHaveBeenCalledWith(-7001, "SIGKILL");
    children[1]!.emit("close", null, "SIGKILL");
    await second;
  });
});
