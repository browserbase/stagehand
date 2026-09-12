import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { flueAdapter } from "../../framework/harnesses/flueAdapter.js";

const taskSpec: TaskSpec = { id: "flue-test", instruction: "do the task" };

describe("Flue trajectory adapter", () => {
  it("pairs native tool events with reasoning and results", () => {
    const trajectory = flueAdapter.fromHarnessResult(
      {
        events: [
          { type: "thinking_delta", delta: "Inspect first" },
          {
            type: "tool_start",
            toolName: "mcp__stagehand__run",
            toolCallId: "1",
            args: { code: "return 1" },
          },
          {
            type: "tool",
            toolName: "mcp__stagehand__run",
            toolCallId: "1",
            isError: false,
            result: "1",
            durationMs: 2,
          },
          { type: "text_delta", text: "finished" },
        ] as never,
      },
      taskSpec,
    );
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "mcp__stagehand__run",
      actionArgs: { code: "return 1" },
      reasoning: "Inspect first",
      toolOutput: { ok: true, result: "1" },
    });
    expect(trajectory.finalAnswer).toBe("finished");
  });

  it("fails unmatched calls closed and attaches observations", () => {
    const trajectory = flueAdapter.fromHarnessResult(
      {
        events: [
          { type: "tool_start", toolName: "mcp__stagehand__run", toolCallId: "1", args: {} },
        ] as never,
        observedToolName: (name) => name.startsWith("mcp__stagehand__"),
        stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput).toMatchObject({ ok: false, error: "no tool result" });
    expect(trajectory.steps[0].probeEvidence.url).toBe("https://example.com");
  });
});
