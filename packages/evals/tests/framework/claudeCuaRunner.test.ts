import { CLAUDE_CUA_TOOL_INSTRUCTIONS } from "../../framework/claudeCuaToolAdapter.js";
import { describe, expect, it } from "vitest";
import type { CuaMessagesClient } from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import type { AvailableModel } from "stagehand-v3";
import { runClaudeCuaAgent } from "../../framework/claudeCuaRunner.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import { EvalLogger } from "../../logger.js";

describe("Claude CUA eval system prompt", () => {
  it("sends the common policy once through the native system channel", async () => {
    let request: Record<string, unknown> | undefined;
    const client: CuaMessagesClient = {
      create: async (params) => {
        request = params;
        return {
          content: [{ type: "text", text: 'EVAL_RESULT: {"success":true}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };
    const instruction = "Find the item and stop before the final purchase.";
    const result = await runClaudeCuaAgent({
      plan: {
        dataset: "webvoyager",
        taskId: "cua-system-prompt",
        startUrl: "https://example.com",
        instruction,
      },
      model: "anthropic/claude-sonnet-5" as AvailableModel,
      logger: new EvalLogger(false),
      client,
      toolAdapter: {
        toolSurface: "anthropic_browser_toolset",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
        promptInstructions: CLAUDE_CUA_TOOL_INSTRUCTIONS,
        executor: {
          execute: async () => {
            throw new Error("This recording client does not request tools.");
          },
        },
        observedToolMatcher: () => true,
        drainObservationsByToolUse: () => new Map(),
        cleanup: async () => {},
      },
    });

    expect(result._success).toBe(true);
    expect(String(request?.system).split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
    expect(request?.system).toContain("browser tools only");
    expect(request?.system).toContain("requested EVAL_RESULT line");
    const messages = JSON.stringify(request?.messages);
    expect(messages).not.toContain(EVAL_SYSTEM_PROMPT);
    expect(messages).toContain(instruction);
    expect(messages).toContain("Browser tool surface: Anthropic Browser Use.");
    expect(messages).not.toContain("Stagehand Playwright facade");
    expect(messages).not.toContain("exactly three tools");
    expect(messages).not.toContain("run, snapshot, screenshot");
  });
});
