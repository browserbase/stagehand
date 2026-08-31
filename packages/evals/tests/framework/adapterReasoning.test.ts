import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { claudeCodeAdapter } from "../../framework/harnesses/claudeCodeAdapter.js";
import { codexAdapter } from "../../framework/harnesses/codexAdapter.js";
import { piAdapter } from "../../framework/harnesses/piAdapter.js";

const taskSpec: TaskSpec = { id: "reasoning-test", instruction: "find the price" };

describe("model reasoning reaches step.reasoning", () => {
  it("claude_code: extended thinking blocks are reasoning but never the answer", () => {
    const trajectory = claudeCodeAdapter.fromHarnessResult(
      {
        messages: [
          {
            type: "assistant",
            message: {
              content: [
                { type: "thinking", thinking: "The price is on the listing page.", signature: "x" },
                { type: "redacted_thinking", data: "opaque" },
                { type: "text", text: "Opening the listing." },
                { type: "tool_use", id: "tu_1", name: "mcp__stagehand__run", input: { code: "1" } },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }],
            },
          },
          {
            type: "assistant",
            message: {
              content: [
                { type: "thinking", thinking: "That settles it.", signature: "y" },
                { type: "text", text: "$42" },
              ],
            },
          },
        ],
        status: "complete",
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]?.reasoning).toBe(
      "The price is on the listing page.\nOpening the listing.",
    );
    expect(trajectory.finalAnswer).toBe("$42");
  });

  it("codex: item.completed reasoning items (the shape Codex emits with model_reasoning_summary set)", () => {
    const trajectory = codexAdapter.fromHarnessResult(
      {
        events: [
          { type: "thread.started", thread_id: "t1" },
          { type: "turn.started" },
          {
            type: "item.completed",
            item: {
              id: "item_0",
              type: "reasoning",
              text: "**Locating the listing**\n\nI need to open the page before reading the price.",
            },
          },
          {
            type: "item.completed",
            item: {
              id: "item_1",
              type: "mcp_tool_call",
              server: "stagehand",
              tool: "run",
              arguments: { code: "1" },
              status: "completed",
              result: { content: [{ type: "text", text: "ok" }] },
            },
          },
          {
            type: "item.completed",
            item: {
              id: "item_2",
              type: "agent_message",
              text: '{"success":true,"summary":"s","finalAnswer":"$42"}',
            },
          },
        ],
        finalAnswer: "$42",
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]?.reasoning).toBe(
      "**Locating the listing**\n\nI need to open the page before reading the price.",
    );
  });

  it("pi: thinking blocks from the Responses reasoning summary become step reasoning", () => {
    const trajectory = piAdapter.fromHarnessResult(
      {
        events: [
          {
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "Open the listing first." },
                { type: "toolCall", id: "c1", name: "stagehand_run", arguments: { code: "1" } },
              ],
            },
          },
          { type: "tool_execution_end", toolCallId: "c1", toolName: "stagehand_run", result: "ok" },
          {
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: "$42" }] },
          },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]?.reasoning).toBe("Open the listing first.");
    expect(trajectory.finalAnswer).toBe("$42");
  });
});
