/* eslint-disable require-yield */
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

  it("reports Claude Code token usage as Braintrust metrics", async () => {
    const sdk: ClaudeAgentSdk = {
      query: async function* () {
        yield {
          type: "result",
          subtype: "success",
          result:
            'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
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
  });

  it("forwards adapter MCP servers into the Claude Code SDK query", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const mcpServers = {
      stagehand_browser: { type: "sdk", name: "stagehand_browser" },
    };
    const sdk: ClaudeAgentSdk = {
      query: async function* (input) {
        capturedOptions = input.options;
        yield {
          type: "result",
          subtype: "success",
          result:
            'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
        };
      },
    };

    await runClaudeCodeAgent({
      plan,
      model: "anthropic/claude-sonnet-4-20250514" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
      toolAdapter: {
        toolSurface: "playwright_code",
        startupProfile: "runner_provided_local_cdp",
        cwd: "/tmp/stagehand-evals-test",
        env: {},
        allowedTools: ["Bash", "mcp__stagehand_browser__run"],
        settingSources: [],
        promptInstructions: "Use run.",
        mcpServers,
        cleanup: async () => {},
      },
    });

    expect(capturedOptions?.mcpServers).toBe(mcpServers);
    expect(capturedOptions?.allowedTools).toEqual([
      "Bash",
      "mcp__stagehand_browser__run",
    ]);
  });
});
