import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  readAntigravitySdkVersion,
  resolveAntigravityRunnerDir,
  runAntigravityAgent,
} from "../../framework/antigravityRunner.js";
import { getBenchHarness } from "../../framework/benchHarness.js";
import type { DeepagentsProcessSpawner } from "../../framework/deepagentsRunner.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

const model = "google/gemini-3.8-flash" as AvailableModel;

function eventSpawner(
  events: Array<Record<string, unknown>>,
  capture?: { args?: string[]; payload?: Record<string, unknown> },
): DeepagentsProcessSpawner {
  return (spec) => {
    if (capture) capture.args = spec.args;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let raw = "";
    stdin.on("data", (chunk) => (raw += chunk.toString()));
    stdin.on("finish", () => {
      if (capture) capture.payload = JSON.parse(raw);
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

describe("Antigravity runner", () => {
  it("is registered with a Gemini default model", () => {
    const harness = getBenchHarness("antigravity");
    expect(harness.harness).toBe("antigravity");
  });

  it("resolves the runner dir from the env override or the repo checkout", () => {
    expect(resolveAntigravityRunnerDir({ STAGEHAND_ANTIGRAVITY_RUNNER_DIR: "/x/runner" })).toBe(
      "/x/runner",
    );
    expect(resolveAntigravityRunnerDir({})).toMatch(/packages\/integrations\/antigravity\/runner$/);
  });

  it("reads the pinned SDK version from uv.lock", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-lock-"));
    fs.writeFileSync(
      path.join(dir, "uv.lock"),
      '[[package]]\nname = "google-antigravity"\nversion = "0.1.20"\n',
    );
    expect(readAntigravitySdkVersion(dir)).toBe("0.1.20");
    expect(readAntigravitySdkVersion(path.join(dir, "missing"))).toBeUndefined();
  });

  it("runs the antigravity runner project and appends the eval policy once", async () => {
    const capture: { args?: string[]; payload?: Record<string, unknown> } = {};
    await runAntigravityAgent({
      plan,
      model,
      logger: new EvalLogger(false),
      spawn: eventSpawner(
        [{ type: "final", text: 'EVAL_RESULT: {"success":true}' }, { type: "usage" }],
        capture,
      ),
    });
    expect(capture.args?.join(" ")).toContain("integrations/antigravity/runner");
    expect(capture.args?.at(-1)).toMatch(/run_eval\.py$/);
    expect(String(capture.payload?.system_prompt).split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
    expect(capture.payload?.system_prompt).toContain("exactly three tools");
    expect(capture.payload?.model).toBe("google_genai:gemini-3.8-flash");
    expect(capture.payload?.prompt).toContain(plan.instruction);
  });

  it("streams a successful run into task metrics", async () => {
    const final = 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}';
    const result = await runAntigravityAgent({
      plan,
      model,
      logger: new EvalLogger(false),
      spawn: eventSpawner([
        { type: "assistant", text: "Open the page", reasoning: "" },
        { type: "tool_call", id: "call_1", name: "run", server: "stagehand", args: {} },
        { type: "tool_result", id: "call_1", name: "run", server: "stagehand", ok: true, text: "ok" },
        { type: "final", text: final },
        {
          type: "usage",
          reported: true,
          input_tokens: 1000,
          output_tokens: 300,
          cache_read_input_tokens: 800,
          reasoning_output_tokens: 200,
          total_tokens: 1300,
        },
      ]),
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("ok");
    expect(result.harnessStatus).toBe("completed");
    expect(result.usageConvention).toBe("openai_cached_subset");
    expect(metrics.harness_input_tokens?.value).toBe(1000);
    expect(metrics.harness_cached_input_tokens?.value).toBe(800);
    expect(metrics.harness_output_tokens?.value).toBe(300);
    expect(metrics.harness_reasoning_output_tokens?.value).toBe(200);
  });

  it("maps a tool-call budget stop to max_turns", async () => {
    const result = await runAntigravityAgent({
      plan,
      model,
      logger: new EvalLogger(false),
      spawn: eventSpawner([
        { type: "error", kind: "tool_step_budget", message: "MAX_TOOL_CALLS_EXCEEDED" },
        { type: "final", text: "" },
        { type: "usage", reported: true, input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      ]),
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("max_turns");
  });
});
