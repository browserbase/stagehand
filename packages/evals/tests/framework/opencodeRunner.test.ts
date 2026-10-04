import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { OpenCodeRuntime, OpenCodeSessionConfig } from "@browserbasehq/stagehand-integrations-opencode-sdk";
import { buildOpenCodePrompt, runOpenCodeAgent } from "../../framework/opencodeRunner.js";
import type { PreparedOpenCodeToolAdapter } from "../../framework/opencodeToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Report the heading",
};

describe("OpenCode runner", () => {
  it("builds an MCP-only browser prompt", () => {
    const prompt = buildOpenCodePrompt(plan, "Use stagehand_run.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Use stagehand_run.");
    expect(prompt).toContain("Your only browser access is the MCP server");
    expect(prompt).toContain("EVAL_RESULT:");
    expect(prompt).not.toContain(EVAL_SYSTEM_PROMPT);
  });

  it("runs through the shared native-system lifecycle and reports metrics", async () => {
    let capturedSession: OpenCodeSessionConfig | undefined;
    const runtime: OpenCodeRuntime = {
      run: async (input) => {
        expect(input.prompt).not.toContain(EVAL_SYSTEM_PROMPT);
        expect(input.maxToolSteps).toBe(50);
        return {
          messages: [
            {
              type: "assistant",
              content: [
                {
                  type: "tool",
                  name: "stagehand_run",
                  state: {
                    status: "completed",
                    input: {},
                    content: [{ type: "text", text: "done" }],
                  },
                },
                {
                  type: "text",
                  text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
                },
              ],
            },
          ],
          finalMessage: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
          status: "completed",
          tokenUsage: {
            reported: true,
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 2,
            cacheCreationInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 15,
          },
          costUsd: 0.02,
        };
      },
      close: async () => undefined,
    };
    const result = await runOpenCodeAgent({
      plan,
      model: "opencode/auto" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: fakeAdapter(),
      startRuntime: async ({ session }) => {
        capturedSession = session;
        return runtime;
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(capturedSession?.config.agents?.build?.system).toBe(EVAL_SYSTEM_PROMPT);
    expect(result.harnessImplementation).toMatchObject({
      name: "sdk",
      version: 1,
      sdkVersion: "2.0.19",
    });
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.opencodeStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(result.terminationReason).toBe("completed");
    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd.value).toBe(0.02);
    expect(metrics.step_budget.value).toBe(50);
  });
});

function fakeAdapter(): PreparedOpenCodeToolAdapter {
  return {
    toolSurface: "stagehand_facade",
    startupProfile: "tool_create_browserbase",
    cwd: "/tmp/workspace",
    configRoot: "/tmp/config",
    config: { mcp: { servers: {} }, permissions: [] },
    promptInstructions: "Use stagehand_run.",
    observedToolMatcher: (name) => name.startsWith("stagehand_"),
    cleanup: async () => undefined,
  };
}
