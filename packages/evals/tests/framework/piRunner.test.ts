import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { buildPiPrompt, parsePiResult, runPiAgent, type PiSdk } from "../../framework/piRunner.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find checkout",
};

describe("pi runner", () => {
  it("builds and parses marker prompts", () => {
    const prompt = buildPiPrompt(plan, "Use the browser tool.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find checkout");
    expect(prompt).toContain("EVAL_RESULT:");
    expect(parsePiResult('{"success":true,"summary":"done"}').success).toBe(true);
    expect(parsePiResult('EVAL_RESULT: {"success":true,"summary":"done"}').success).toBe(true);
    expect(
      parsePiResult('intro line\nEVAL_RESULT: {"success":true,"summary":"done"}\ntrailing').success,
    ).toBe(true);
    // Markers are line-anchored: an inline mention inside prose is not a report.
    expect(
      parsePiResult('prefix EVAL_RESULT: {"success":true,"summary":"done"}\ntrailing').success,
    ).toBe(false);
  });

  it("returns successful results and portable metrics", async () => {
    let options: Record<string, unknown> | undefined;
    const sdk: PiSdk = {
      async createSession(input) {
        options = input;
        let listener: (event: Record<string, unknown>) => void = () => {};
        return {
          agent: { state: {} },
          subscribe(next) {
            listener = next;
            return () => {};
          },
          async prompt() {
            listener({
              type: "message_end",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
                  },
                ],
                stopReason: "stop",
                usage: {
                  input: 100,
                  output: 25,
                  cacheRead: 10,
                  cacheWrite: 5,
                  reasoning: 3,
                  totalTokens: 140,
                  cost: { total: 0.42 },
                },
              },
            });
            listener({ type: "turn_end" });
          },
          async abort() {},
          dispose() {},
        };
      },
    };
    const customTool = { name: "test" } as never;
    const result = await runPiAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/tmp/pi-runner",
        env: {},
        promptInstructions: "Use browser.",
        customTools: [customTool],
        cleanup: async () => {},
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.piStatus).toBe("completed");
    expect(result.harnessStatus).toBe("completed");
    expect(metrics.pi_turns.value).toBe(1);
    expect(metrics.harness_input_tokens.value).toBe(100);
    expect(metrics.harness_output_tokens.value).toBe(25);
    expect(metrics.harness_cached_input_tokens.value).toBe(10);
    expect(metrics.harness_cache_creation_input_tokens.value).toBe(5);
    expect(metrics.harness_total_tokens.value).toBe(140);
    expect(metrics.harness_cost_usd.value).toBe(0.42);
    expect(options).toMatchObject({
      cwd: "/tmp/pi-runner",
      customTools: [customTool],
    });
    expect(String(options?.systemPrompt)).toContain("Do not edit repository files");
  });

  it("returns a failed task result for SDK failures", async () => {
    const sdk: PiSdk = {
      async createSession() {
        throw new Error("pi failed");
      },
    };
    const result = await runPiAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });
    expect(result._success).toBe(false);
    expect(result.piStatus).toBe("sdk_error");
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBeDefined();
    expect(String(result.error)).toContain("pi failed");
  });
});
