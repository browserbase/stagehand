import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { OpenCodeRuntime } from "@browserbasehq/stagehand-integrations-opencode-sdk";
import { buildOpenCodePrompt, runOpenCodeAgent } from "../../framework/opencodeRunner.js";
import type { PreparedOpenCodeToolAdapter } from "../../framework/opencodeToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
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
  });

  it("runs through the shared external lifecycle and reports metrics", async () => {
    const runtime: OpenCodeRuntime = {
      client: {
        session: {
          create: async () => ({ data: { id: "session-1" } }),
          prompt: async () => ({
            data: {
              info: {
                role: "assistant",
                cost: 0.02,
                tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 0 } },
              },
              parts: [
                {
                  type: "tool",
                  tool: "stagehand_run",
                  state: { status: "completed", input: {}, output: "done" },
                },
                {
                  type: "text",
                  text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
                },
              ],
            },
          }),
          abort: async () => ({ data: true }),
          delete: async () => ({ data: true }),
        },
      },
      close: () => undefined,
    };
    const result = await runOpenCodeAgent({
      plan,
      model: "opencode/auto" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: fakeAdapter(),
      startRuntime: async () => runtime,
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.opencodeStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd.value).toBe(0.02);
  });
});

function fakeAdapter(): PreparedOpenCodeToolAdapter {
  return {
    toolSurface: "stagehand_facade",
    startupProfile: "tool_create_browserbase",
    cwd: "/tmp/workspace",
    configRoot: "/tmp/config",
    config: {},
    enabledTools: { "stagehand_*": true },
    promptInstructions: "Use stagehand_run.",
    observedToolMatcher: (name) => name.startsWith("stagehand_"),
    cleanup: async () => undefined,
  };
}
