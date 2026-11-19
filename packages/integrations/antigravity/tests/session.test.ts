import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_FACADE_SYSTEM_PROMPT,
  DEFAULT_ANTIGRAVITY_RUNNER_DIR,
  normalizeAntigravityModel,
  readAntigravitySdkVersion,
  readAntigravityThinkingLevel,
  resolveAntigravityRunnerDir,
  runAntigravitySession,
  type AntigravityProcessSpawner,
} from "../src/index.js";

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const logger = { log: () => {}, warn: () => {}, error: () => {} };

type Capture = {
  command?: string;
  args?: string[];
  cwd?: string;
  payload?: Record<string, unknown>;
};

function eventSpawner(
  events: Array<Record<string, unknown>>,
  capture: Capture = {},
): AntigravityProcessSpawner {
  return (spec) => {
    capture.command = spec.command;
    capture.args = spec.args;
    capture.cwd = spec.cwd;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let raw = "";
    stdin.on("data", (chunk) => (raw += chunk.toString()));
    stdin.on("finish", () => {
      capture.payload = JSON.parse(raw);
    });
    queueMicrotask(() => {
      for (const event of events) stdout.write(`${JSON.stringify(event)}\n`);
      stdout.end();
      stderr.end();
    });
    return {
      stdin,
      stdout,
      stderr,
      exited: Promise.resolve({ code: 0, signal: null }),
      kill: () => {},
    };
  };
}

describe("runner dir", () => {
  it("defaults to the bundled uv project", () => {
    expect(path.resolve(DEFAULT_ANTIGRAVITY_RUNNER_DIR)).toBe(path.join(PACKAGE_DIR, "runner"));
    expect(fs.existsSync(path.join(DEFAULT_ANTIGRAVITY_RUNNER_DIR, "run_eval.py"))).toBe(true);
  });

  it("prefers an explicit override, then the env override", () => {
    const env = { STAGEHAND_ANTIGRAVITY_RUNNER_DIR: "/env/runner" };
    expect(resolveAntigravityRunnerDir("/x/runner", env)).toBe("/x/runner");
    expect(resolveAntigravityRunnerDir(undefined, env)).toBe("/env/runner");
    expect(resolveAntigravityRunnerDir(undefined, {})).toBe(DEFAULT_ANTIGRAVITY_RUNNER_DIR);
  });

  it("reads the SDK version pinned in uv.lock", () => {
    expect(readAntigravitySdkVersion(DEFAULT_ANTIGRAVITY_RUNNER_DIR)).toBe("0.1.20");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-lock-"));
    fs.writeFileSync(
      path.join(dir, "uv.lock"),
      '[[package]]\nname = "google-antigravity"\nversion = "9.9.9"\n',
    );
    expect(readAntigravitySdkVersion(dir)).toBe("9.9.9");
    expect(readAntigravitySdkVersion(path.join(dir, "missing"))).toBeUndefined();
  });
});

describe("normalizeAntigravityModel", () => {
  it("strips Google provider prefixes", () => {
    expect(normalizeAntigravityModel("google/gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(normalizeAntigravityModel("google_genai:gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(normalizeAntigravityModel("gemini:gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(normalizeAntigravityModel("gemini-3.8-flash")).toBe("gemini-3.8-flash");
  });

  it("rejects other providers", () => {
    for (const model of ["openai/gpt-5", "anthropic:claude", "google/", ""]) {
      expect(() => normalizeAntigravityModel(model)).toThrow(/Gemini models only/);
    }
  });
});

describe("readAntigravityThinkingLevel", () => {
  it("reads the env knob and treats blank as unset", () => {
    expect(readAntigravityThinkingLevel({ EVAL_ANTIGRAVITY_THINKING_LEVEL: " high " })).toBe(
      "high",
    );
    expect(readAntigravityThinkingLevel({ EVAL_ANTIGRAVITY_THINKING_LEVEL: " " })).toBeUndefined();
    expect(readAntigravityThinkingLevel({})).toBeUndefined();
  });
});

describe("runAntigravitySession", () => {
  it("spawns the bundled runner with its own uv project and a bare Gemini model", async () => {
    const capture: Capture = {};
    const result = await runAntigravitySession({
      prompt: "Find the checkout button",
      model: "google/gemini-3.8-flash",
      logger,
      spawn: eventSpawner(
        [{ type: "final", text: 'EVAL_RESULT: {"success":true}' }, { type: "usage" }],
        capture,
      ),
      session: {
        cwd: "/tmp/work",
        systemPrompt: `policy\n\n${ANTIGRAVITY_FACADE_SYSTEM_PROMPT}`,
        maxToolSteps: 7,
        mcpServers: { stagehand: { command: "node", args: ["facade.js"], cwd: "/srv" } },
      },
    });
    const runnerDir = DEFAULT_ANTIGRAVITY_RUNNER_DIR;
    expect(capture.command).toBe(process.env.STAGEHAND_DEEPAGENTS_UV ?? "uv");
    expect(capture.args).toEqual([
      "run",
      "--project",
      runnerDir,
      "--locked",
      "python",
      path.join(runnerDir, "run_eval.py"),
    ]);
    expect(capture.cwd).toBe("/tmp/work");
    expect(capture.payload).toMatchObject({
      prompt: "Find the checkout button",
      model: "gemini-3.8-flash",
      max_tool_steps: 7,
      mcp_servers: { stagehand: { command: "node", args: ["facade.js"], cwd: "/srv" } },
    });
    expect(capture.payload?.system_prompt).toContain("exactly three tools");
    expect(capture.payload?.system_prompt).toContain("view_file");
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe('EVAL_RESULT: {"success":true}');
  });

  it("honours an explicit runner dir", async () => {
    const capture: Capture = {};
    await runAntigravitySession({
      prompt: "go",
      model: "gemini-3.8-flash",
      logger,
      spawn: eventSpawner([{ type: "final", text: "" }, { type: "usage" }], capture),
      session: { runnerDir: "/custom/runner" },
    });
    expect(capture.args).toEqual([
      "run",
      "--project",
      "/custom/runner",
      "--locked",
      "python",
      path.join("/custom/runner", "run_eval.py"),
    ]);
  });

  it("maps a tool-call budget stop to max_turns", async () => {
    const result = await runAntigravitySession({
      prompt: "go",
      model: "google/gemini-3.8-flash",
      logger,
      spawn: eventSpawner([
        { type: "error", kind: "tool_step_budget", message: "MAX_TOOL_CALLS_EXCEEDED" },
        { type: "final", text: "" },
        { type: "usage", reported: true, input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      ]),
      session: {},
    });
    expect(result.status).toBe("max_turns");
  });

  it("rejects a non-Gemini model before spawning", async () => {
    const capture: Capture = {};
    await expect(
      runAntigravitySession({
        prompt: "go",
        model: "openai/gpt-5",
        logger,
        spawn: eventSpawner([], capture),
        session: {},
      }),
    ).rejects.toThrow(/Gemini models only/);
    expect(capture.args).toBeUndefined();
  });
});
