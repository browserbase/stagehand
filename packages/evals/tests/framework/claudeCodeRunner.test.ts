/* eslint-disable require-yield */
import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  buildClaudeCodePrompt,
  parseClaudeCodeResult,
  runClaudeCodeAgent,
} from "../../framework/claudeCodeRunner.js";
import { EvalLogger } from "../../logger.js";
import type { ClaudeAgentSdk } from "../../framework/claudeCodeRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

describe("claude code runner helpers", () => {
  it("builds a browser task prompt with the required result marker", () => {
    const prompt = buildClaudeCodePrompt(plan, "Use browse only. Discover usage with browse -h.");

    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use browse only.");
    expect(prompt).toContain("browse -h");
    expect(prompt).toContain("EVAL_RESULT:");
  });

  it("parses the final EVAL_RESULT JSON line", () => {
    expect(
      parseClaudeCodeResult(
        'intermediate text\nEVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"clicked"}',
      ),
    ).toEqual({
      success: true,
      summary: "done",
      finalAnswer: "clicked",
      raw: 'intermediate text\nEVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"clicked"}',
    });
  });

  it("marks malformed results as failed", () => {
    expect(parseClaudeCodeResult("not json")).toMatchObject({
      success: false,
      raw: "not json",
    });
  });

  it("parses marked result JSON from the first line after the marker", () => {
    expect(
      parseClaudeCodeResult(
        'assistant text\nEVAL_RESULT: {"success":true,"summary":"done"}\ntrailing sdk text',
      ),
    ).toMatchObject({
      success: true,
      summary: "done",
    });
  });

  it("parses result JSON wrapped in Markdown emphasis", () => {
    expect(
      parseClaudeCodeResult(
        '**EVAL_RESULT: {"success":true,"summary":"found {the result}","finalAnswer":"done"}**',
      ),
    ).toMatchObject({
      success: true,
      summary: "found {the result}",
      finalAnswer: "done",
    });
  });

  it("surfaces verifier integration failures as verifierError on the self-reported result", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"done"}',
              },
            ],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"done"}',
        };
      },
    };

    const result = await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
      verifier: {
        v3: {} as never,
        taskSpec: {
          id: "wv-1",
          instruction: plan.instruction,
          // Malformed rubric — normalizeRubric throws inside the verifier
          // path, exercising the integration-failure fallback.
          precomputedRubric: {} as never,
        },
        dataset: "webvoyager",
      },
    });

    // The agent's self-report is preserved, the failure is visible, and no
    // verifier-graded fields are present.
    expect(result._success).toBe(true);
    expect(String(result.verifierError)).toContain("items array");
    expect(result.outcomeSuccess).toBeUndefined();
    expect(result.processScore).toBeUndefined();
  });

  it("prefers iteration errors over result text for failed Claude Code runs", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield { type: "result", subtype: "error", result: "less useful result text" };
        throw new Error("specific iteration failure");
      },
    };

    const result = await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });

    expect(result._success).toBe(false);
    expect(result.error).toBe("specific iteration failure");
  });

  it("reports Claude Code token usage as Braintrust metrics", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "result",
          subtype: "success",
          result: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
          duration_ms: 1234,
          num_turns: 3,
          total_cost_usd: 0.045,
          usage: {
            input_tokens: 100,
            output_tokens: 25,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        };
      },
    };

    const result = await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(metrics.claude_code_input_tokens.value).toBe(100);
    expect(metrics.claude_code_output_tokens.value).toBe(25);
    expect(metrics.claude_code_cache_creation_input_tokens.value).toBe(10);
    expect(metrics.claude_code_cache_read_input_tokens.value).toBe(5);
    expect(metrics.claude_code_total_tokens.value).toBe(140);
    expect(metrics.harness_input_tokens.value).toBe(100);
    expect(metrics.harness_output_tokens.value).toBe(25);
    expect(metrics.harness_cache_creation_input_tokens.value).toBe(10);
    expect(metrics.harness_total_tokens.value).toBe(140);
    expect(metrics.harness_cost_usd.value).toBe(0.045);
    expect(result.harnessStatus).toBe("completed");
    expect(result.claudeCodeStatus).toBe("completed");
  });
});
