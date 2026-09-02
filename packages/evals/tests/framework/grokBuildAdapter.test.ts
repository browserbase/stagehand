import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { grokBuildAdapter } from "../../framework/harnesses/grokBuildAdapter.js";

const taskSpec: TaskSpec = { id: "grok-build-test", instruction: "do the task" };

describe("Grok Build trajectory adapter", () => {
  it("pairs native tool calls and carries thought text into reasoning", () => {
    const trajectory = grokBuildAdapter.fromHarnessResult(
      {
        events: [
          { type: "thought", data: "I will inspect the page." },
          {
            type: "tool_call",
            toolCallId: "call-1",
            toolName: "stagehand__snapshot",
            rawInput: {},
          },
          {
            type: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            rawOutput: { title: "Example" },
          },
        ],
        finalAnswer: "Example",
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "stagehand__snapshot",
      reasoning: "I will inspect the page.",
      toolOutput: { ok: true, result: { title: "Example" } },
    });
    expect(trajectory.finalAnswer).toBe("Example");
  });

  it("fails open tool calls closed and attaches matching observations", () => {
    const trajectory = grokBuildAdapter.fromHarnessResult(
      {
        events: [
          {
            type: "tool_call",
            toolCallId: "call-1",
            toolName: "stagehand__run",
            rawInput: {},
          },
        ],
        observedToolName: (name) => name.startsWith("stagehand__"),
        stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput).toMatchObject({
      ok: false,
      error: "no tool result",
    });
    expect(trajectory.steps[0].probeEvidence.url).toBe("https://example.com");
  });
});
