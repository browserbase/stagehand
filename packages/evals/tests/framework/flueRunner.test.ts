import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import { buildFluePrompt, runFlueAgent } from "../../framework/flueRunner.js";
import type { PreparedFlueToolAdapter } from "../../framework/flueToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Report the heading",
};

describe("Flue runner", () => {
  it("builds a browser-only prompt", () => {
    const prompt = buildFluePrompt(plan, "Use mcp__stagehand__run.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Use mcp__stagehand__run.");
    expect(prompt).toContain("Your only browser access is through the provided tools");
    expect(prompt).toContain("EVAL_RESULT:");
  });

  it("uses the shared external lifecycle and reports Flue metrics", async () => {
    const result = await runFlueAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: fakeAdapter(),
      runSession: async () => ({
        events: [
          { type: "tool_start", toolName: "mcp__stagehand__run", toolCallId: "1", args: {} },
          {
            type: "tool",
            toolName: "mcp__stagehand__run",
            toolCallId: "1",
            isError: false,
            result: "done",
            durationMs: 1,
          },
        ] as never,
        finalMessage: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
        status: "completed",
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          cacheCreationInputTokens: 1,
          totalTokens: 15,
          costUsd: 0.02,
        },
      }),
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.flueStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(metrics.flue_tool_steps.value).toBe(1);
    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd.value).toBe(0.02);
  });
});

function fakeAdapter(): PreparedFlueToolAdapter {
  return {
    toolSurface: "stagehand_facade",
    startupProfile: "tool_create_browserbase",
    cwd: "/tmp/workspace",
    tools: [],
    promptInstructions: "Use mcp__stagehand__run.",
    observedToolMatcher: (name) => name.startsWith("mcp__stagehand__"),
    cleanup: async () => undefined,
  };
}
