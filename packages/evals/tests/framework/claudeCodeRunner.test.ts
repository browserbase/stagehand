import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import {
  buildClaudeCodePrompt,
  isClaudeCodeMaxTurnsError,
  normalizeClaudeCodeModel,
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
  it("normalizes provider-prefixed models for Claude Code", () => {
    expect(
      normalizeClaudeCodeModel(
        "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      ),
    ).toBe("claude-sonnet-4-20250514");
    expect(normalizeClaudeCodeModel("claude-opus-4-1" as AvailableModel)).toBe(
      "claude-opus-4-1",
    );
  });

  it("builds a browser task prompt with the required result marker", () => {
    const prompt = buildClaudeCodePrompt(
      plan,
      "Use browse only. Discover usage with browse -h.",
    );

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

  it("identifies max-turn SDK errors", () => {
    expect(
      isClaudeCodeMaxTurnsError(
        new Error("Reached maximum number of turns (20)"),
      ),
    ).toBe(true);
    expect(isClaudeCodeMaxTurnsError("network failed")).toBe(false);
  });

  it("returns a normal task result when Claude Code reaches max turns after emitting a result", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: 'EVAL_RESULT: {"success":true,"summary":"already complete","finalAnswer":"done"}',
              },
            ],
          },
        };
        throw new Error("Reached maximum number of turns (20)");
      },
    };

    const result = await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });

    expect(result._success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.claudeCodeStatus).toBe("max_turns");
    expect(result.finalAnswer).toBe("done");
  });

  it("returns a failed task result instead of throwing when max turns prevents a result", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        throw new Error("Reached maximum number of turns (20)");
      },
    };

    const result = await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });

    expect(result._success).toBe(false);
    expect(result.claudeCodeStatus).toBe("max_turns");
    expect(String(result.error)).toContain("maximum number of turns");
  });
});
