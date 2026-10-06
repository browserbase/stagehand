import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { GrokBuildProcessRunner } from "@browserbasehq/stagehand-integrations-grok-build-sdk";
import { buildGrokBuildPrompt, runGrokBuildAgent } from "../../framework/grokBuildRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Report the heading",
};

describe("Grok Build runner", () => {
  beforeEach(() => {
    vi.stubEnv("EVAL_GROK_BUILD_ALWAYS_APPROVE", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an MCP-only browser prompt", () => {
    const prompt = buildGrokBuildPrompt(plan, "Use stagehand__run.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Use stagehand__run.");
    expect(prompt).toContain("Your only browser access is the MCP server");
    expect(prompt).toContain("EVAL_RESULT:");
    expect(prompt).not.toContain(EVAL_SYSTEM_PROMPT);
  });

  it("runs the native stream and reports Grok Build metrics", async () => {
    let capturedArgs: string[] = [];
    const result = await runGrokBuildAgent({
      plan,
      model: "grok-build/auto" as AvailableModel,
      logger: new EvalLogger(false),
      runProcess: scriptedRunner(
        [
          {
            type: "tool_call",
            toolCallId: "1",
            toolName: "stagehand__run",
            rawInput: { code: "return 1" },
          },
          {
            type: "tool_call_update",
            toolCallId: "1",
            status: "completed",
            rawOutput: "done",
          },
          {
            type: "text",
            data: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
          },
          {
            type: "end",
            stopReason: "end_turn",
            num_turns: 2,
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            total_cost_usd: 0.02,
          },
        ],
        0,
        (args) => {
          capturedArgs = args;
        },
      ),
    });
    const metrics = result.metrics as Record<string, { value: number; count: number }>;
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.grokBuildStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(metrics.grok_build_tool_steps.value).toBe(1);
    expect(metrics.grok_build_num_turns.value).toBe(2);
    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd.value).toBe(0.02);
    expect(metrics.step_budget.value).toBe(50);
    expect(result.harnessImplementation).toMatchObject({ name: "cli", version: 1 });
    expect(capturedArgs).toContain("--rules");
    expect(capturedArgs).toContain(EVAL_SYSTEM_PROMPT);
    expect(capturedArgs).toContain("--max-turns");
    expect(capturedArgs).toContain("--always-approve");
    expect(result.harnessConfiguration).toMatchObject({ alwaysApprove: true });
  });

  it.each(["true", "false"])("respects the approval override %s", async (value) => {
    vi.stubEnv("EVAL_GROK_BUILD_ALWAYS_APPROVE", value);
    let capturedArgs: string[] = [];
    const result = await runGrokBuildAgent({
      plan,
      model: "grok-build/auto" as AvailableModel,
      logger: new EvalLogger(false),
      runProcess: scriptedRunner([{ type: "end", stopReason: "end_turn" }], 0, (args) => {
        capturedArgs = args;
      }),
    });
    expect(capturedArgs.includes("--always-approve")).toBe(value === "true");
    expect(result.harnessConfiguration).toMatchObject({ alwaysApprove: value === "true" });
  });

  it.each(["", "1", "TRUE", "invalid"])(
    "rejects invalid approval override %j before launch",
    async (value) => {
      vi.stubEnv("EVAL_GROK_BUILD_ALWAYS_APPROVE", value);
      const runProcess = vi.fn<GrokBuildProcessRunner>();
      await expect(
        runGrokBuildAgent({
          plan,
          model: "grok-build/auto" as AvailableModel,
          logger: new EvalLogger(false),
          runProcess,
        }),
      ).rejects.toThrow("EVAL_GROK_BUILD_ALWAYS_APPROVE must be true or false.");
      expect(runProcess).not.toHaveBeenCalled();
    },
  );

  it("returns a failed result for a non-zero exit without an end event", async () => {
    const result = await runGrokBuildAgent({
      plan,
      model: "grok-build/auto" as AvailableModel,
      logger: new EvalLogger(false),
      runProcess: scriptedRunner([], 1),
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.error).toContain("exited with code 1");
  });
});

function scriptedRunner(
  events: Array<Record<string, unknown>>,
  exitCode = 0,
  onArgs?: (args: string[]) => void,
): GrokBuildProcessRunner {
  return async (input) => {
    onArgs?.(input.args);
    for (const event of events) await input.onStdoutLine(JSON.stringify(event));
    return { exitCode, signal: null };
  };
}
