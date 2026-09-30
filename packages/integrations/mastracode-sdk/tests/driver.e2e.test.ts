/**
 * Keyless end-to-end check of the real driver: the built dist/driver.mjs boots
 * mastracode against a loopback fake of the Anthropic Messages API and a stub
 * stdio MCP server with the facade's tool names. It proves, from the request
 * bodies mastracode actually sends, that only the facade tools are offered and
 * that the direct anthropic/* route carries prompt-cache breakpoints.
 *
 * Opt-in (boots the full mastracode stack, ~5-10 s): build the package, then
 *   MASTRACODE_DRIVER_E2E=1 pnpm --filter @browserbasehq/stagehand-integrations-mastracode-sdk test:unit
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MASTRACODE_PROTOCOL_VERSION,
  runMastracodeSession,
  toolNamesFor,
  type MastracodeDriverRequest,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const driverPath = path.resolve(here, "../dist/driver.mjs");
const enabled = process.env.MASTRACODE_DRIVER_E2E === "1" && fs.existsSync(driverPath);

interface CapturedRequest {
  body: Record<string, unknown>;
  raw: string;
}

function sse(events: Array<Record<string, unknown>>): string {
  return events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function messageStart(id: string, usage: Record<string, number>) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { output_tokens: 1, ...usage },
    },
  };
}

function toolTurn(id: string, usage: Record<string, number>, toolName: string, input: unknown) {
  return sse([
    messageStart(id, usage),
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Checking the page." },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: `toolu_${id}`, name: toolName, input: {} },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  ]);
}

function textTurn(id: string, usage: Record<string, number>, text: string) {
  return sse([
    messageStart(id, usage),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 30 },
    },
    { type: "message_stop" },
  ]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const FINAL = '{"success":true,"summary":"done","finalAnswer":"42"}';

describe.skipIf(!enabled)("mastracode driver end to end (fake Anthropic)", () => {
  let server: http.Server;
  let baseUrl: string;
  let root: string;
  const captured: CapturedRequest[] = [];
  const sideCalls: CapturedRequest[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += String(chunk)));
      req.on("end", () => {
        if (req.method !== "POST" || !req.url?.endsWith("/messages")) {
          res.writeHead(404).end();
          return;
        }
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (!Array.isArray(body.tools) || body.tools.length === 0) {
          // Side calls (thread title, observational memory) carry no tools.
          sideCalls.push({ body, raw });
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(textTurn("side", { input_tokens: 5 }, "Side call"));
          return;
        }
        captured.push({ body, raw });
        const turn = captured.length;
        const payload =
          turn === 1
            ? toolTurn(
                "1",
                { input_tokens: 50, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 },
                "stagehand_snapshot",
                {},
              )
            : turn === 2
              ? toolTurn(
                  "2",
                  {
                    input_tokens: 60,
                    cache_creation_input_tokens: 300,
                    cache_read_input_tokens: 4000,
                  },
                  "stagehand_screenshot",
                  {},
                )
              : textTurn(
                  "3",
                  {
                    input_tokens: 70,
                    cache_creation_input_tokens: 200,
                    cache_read_input_tokens: 4300,
                  },
                  FINAL,
                );
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(payload);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "mastracode-e2e-"));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (root) await fsp.rm(root, { recursive: true, force: true });
  });

  const facadeToolNames = toolNamesFor("stagehand");
  async function makeRequest(
    stepBudget: number,
    extra: Partial<MastracodeDriverRequest> = {},
    mcpEnv: Record<string, string> = {},
  ): Promise<MastracodeDriverRequest> {
    const runRoot = await fsp.mkdtemp(path.join(root, "run-"));
    await Promise.all(
      ["home", "appdata", "workspace"].map((dir) => fsp.mkdir(path.join(runRoot, dir))),
    );
    return {
      version: MASTRACODE_PROTOCOL_VERSION,
      prompt: "Open the page and report the answer.",
      hostInstructions: "EVAL POLICY: never ask clarifying questions.",
      modelId: "anthropic/claude-sonnet-4-6",
      stepBudget,
      timeoutMs: 60_000,
      mcpServers: {
        stagehand: {
          command: process.execPath,
          args: [path.join(here, "fixtures/stub-mcp-server.mjs")],
          env: { PATH: process.env.PATH ?? "", ...mcpEnv },
        },
      },
      facadeToolNames,
      workspaceDir: path.join(runRoot, "workspace"),
      appDataDir: path.join(runRoot, "appdata"),
      homeDir: path.join(runRoot, "home"),
      ...extra,
    };
  }

  function driverEnv(request: MastracodeDriverRequest): Record<string, string> {
    return {
      PATH: process.env.PATH ?? "",
      HOME: request.homeDir,
      MASTRA_APP_DATA_DIR: request.appDataDir,
      MASTRA_TELEMETRY_DISABLED: "1",
      ANTHROPIC_API_KEY: "sk-ant-fake-e2e",
      ANTHROPIC_BASE_URL: baseUrl,
    };
  }

  async function runDriver(
    stepBudget: number,
    extra: Partial<MastracodeDriverRequest> = {},
    mcpEnv: Record<string, string> = {},
  ) {
    captured.length = 0;
    sideCalls.length = 0;
    const request = await makeRequest(stepBudget, extra, mcpEnv);
    const stderr: string[] = [];
    const result = await runMastracodeSession({
      request,
      cwd: request.workspaceDir,
      driverPath,
      env: driverEnv(request),
      killAfterMs: 90_000,
      onStderrLine: (line) => stderr.push(line),
    });
    const context = `status=${result.status} stop=${result.stopReason} err=${result.iterationError}\n${stderr.slice(-30).join("\n")}`;
    return { result, context };
  }

  it("offers only the facade tools, places cache breakpoints, and sums cache usage", async () => {
    const { result, context } = await runDriver(10);

    const dumpDir = process.env.MASTRACODE_E2E_DUMP_DIR;
    if (dumpDir) {
      fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(
        path.join(dumpDir, "requests.json"),
        JSON.stringify(
          {
            agent: captured.map((entry) => entry.body),
            side: sideCalls.map((entry) => entry.body),
            events: result.events,
          },
          null,
          2,
        ),
      );
    }
    expect(result.status, context).toBe("completed");
    expect(result.ready?.mcpTools.sort()).toEqual([...facadeToolNames].sort());
    expect(result.violations).toEqual([]);
    expect(result.finalText).toBe(FINAL);
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toBe(2);

    // Request-level guarantees, from the bodies mastracode actually sent.
    expect(captured).toHaveLength(3);
    for (const { body, raw } of captured) {
      const names = ((body.tools as Array<{ name: string }>) ?? []).map((tool) => tool.name).sort();
      expect(names).toEqual([...facadeToolNames].sort());
      expect(raw.match(/"cache_control"\s*:/gu)?.length).toBe(2);
      const system = JSON.stringify(body.system);
      expect(system).toContain("EVAL POLICY: never ask clarifying questions.");
      // permissionRules deny: mastracode's tool guidance no longer describes
      // tools the session does not have, nor asking the user.
      expect(system).not.toContain("ask_user");
      expect(system).not.toContain("web_search");
      expect(system).not.toContain("task_write");
      expect(system).not.toContain("**execute_command**");
      expect(system).not.toContain("**view**");
      expect(system).not.toContain("# Subagent Rules");
      expect(system).toContain("There is no user to ask");
    }
    const agentRequests = result.requests.filter((entry) => entry.role === "agent");
    expect(agentRequests.map((entry) => entry.cacheBreakpoints)).toEqual([2, 2, 2]);

    // AI SDK v6 input total = uncached + cache read + cache write.
    expect(result.usage).toMatchObject({
      promptTokens: 50 + 4000 + (60 + 300 + 4000) + (70 + 200 + 4300),
      cachedInputTokens: 4000 + 4300,
      cacheCreationInputTokens: 4000 + 300 + 200,
      completionTokens: 20 + 20 + 30,
    });
    expect(result.done?.sessionTokenUsage?.promptTokens).toBe(result.usage?.promptTokens);
    // mastracode's own per-step usage matches the raw provider responses.
    expect(result.responseUsage.agent).toMatchObject({
      requests: 3,
      inputTokens: result.usage?.promptTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
      cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
      outputTokens: result.usage?.completionTokens,
    });
    // Side calls (thread title) take the eval model's route, so the fake
    // endpoint sees them and their usage is parsed, not lost on google/*.
    expect(sideCalls.length).toBeGreaterThanOrEqual(1);
    for (const { body } of sideCalls) expect(body.model).toBe("claude-sonnet-4-6");
    expect(result.responseUsage.side?.requests).toBe(sideCalls.length);
    expect(result.responseUsage.side?.models).toEqual(["claude-sonnet-4-6"]);
  }, 120_000);

  it("ends a wedged MCP startup with startup_timeout and reaps the MCP child", async () => {
    const pidFile = path.join(root, `mcp-pid-${Date.now()}`);
    const started = Date.now();
    const { result, context } = await runDriver(
      10,
      { startupTimeoutMs: 3_000 },
      { STUB_MCP_HANG_LIST_TOOLS: "1", STUB_MCP_PID_FILE: pidFile },
    );
    expect(result.status, context).toBe("sdk_error");
    expect(result.stopReason, context).toBe("startup_timeout");
    expect(result.iterationError).toContain("startup timed out");
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(captured).toHaveLength(0);
    const mcpPid = Number(fs.readFileSync(pidFile, "utf8"));
    await expect.poll(() => isAlive(mcpPid), { timeout: 5_000 }).toBe(false);
  }, 120_000);

  it("aborts itself and its MCP child when its parent dies without cleanup (SIGKILL)", async () => {
    const pidFile = path.join(root, `mcp-pid-orphan-${Date.now()}`);
    const request = await makeRequest(
      10,
      { startupTimeoutMs: 600_000 },
      { STUB_MCP_HANG_LIST_TOOLS: "1", STUB_MCP_PID_FILE: pidFile },
    );
    // A stand-in evals parent: spawns the driver detached (like the real
    // runner), reports its pid, then idles until SIGKILLed.
    const parentScript = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, [${JSON.stringify(driverPath)}], {`,
      `  cwd: ${JSON.stringify(request.workspaceDir)}, env: ${JSON.stringify(driverEnv(request))},`,
      '  stdio: ["pipe", "pipe", "ignore"], detached: true });',
      `child.stdin.end(${JSON.stringify(JSON.stringify(request))});`,
      "child.stdout.resume();",
      "process.stdout.write(String(child.pid) + '\\n');",
      "setInterval(() => undefined, 60_000);",
    ].join("\n");
    const parent = spawn(process.execPath, ["-e", parentScript], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const driverPid = await new Promise<number>((resolve, reject) => {
      parent.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())));
      parent.once("error", reject);
    });
    expect(driverPid).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(isAlive(driverPid)).toBe(true);
    const mcpPid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(isAlive(mcpPid)).toBe(true);
    parent.kill("SIGKILL");
    try {
      await expect.poll(() => isAlive(driverPid), { timeout: 10_000, interval: 250 }).toBe(false);
      await expect.poll(() => isAlive(mcpPid), { timeout: 5_000, interval: 250 }).toBe(false);
    } finally {
      if (isAlive(driverPid)) process.kill(-driverPid, "SIGKILL");
    }
  }, 60_000);

  it("stops at the step budget after a tool-calling step with max_turns", async () => {
    const { result, context } = await runDriver(1);
    expect(result.status, context).toBe("max_turns");
    expect(result.steps).toBe(1);
    expect(captured).toHaveLength(1);
    expect(result.usage?.cacheCreationInputTokens).toBe(4000);
    expect(result.usage?.cachedInputTokens).toBe(0);
  }, 120_000);
});
