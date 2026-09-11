import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { opencodeAdapter } from "../../framework/harnesses/opencodeAdapter.js";

const taskSpec: TaskSpec = { id: "opencode-test", instruction: "do the task" };

describe("OpenCode trajectory adapter", () => {
  it("maps reasoning, tool calls, results, and final text", () => {
    const trajectory = opencodeAdapter.fromHarnessResult(
      {
        messages: [
          {
            info: {},
            parts: [
              { type: "reasoning", text: "Inspect first" },
              {
                type: "tool",
                tool: "stagehand_run",
                state: { status: "completed", input: { code: "return 1" }, output: "1" },
              },
              { type: "text", text: "finished" },
            ],
          },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "stagehand_run",
      actionArgs: { code: "return 1" },
      reasoning: "Inspect first",
      toolOutput: { ok: true, result: "1" },
    });
    expect(trajectory.finalAnswer).toBe("finished");
  });

  it("marks incomplete calls failed and attaches observations", () => {
    const trajectory = opencodeAdapter.fromHarnessResult(
      {
        messages: [
          {
            info: {},
            parts: [
              { type: "tool", tool: "stagehand_run", state: { status: "running", input: {} } },
            ],
          },
        ],
        observedToolName: (name) => name.startsWith("stagehand_"),
        stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }],
      },
      taskSpec,
    );
    expect(trajectory.steps[0].toolOutput.ok).toBe(false);
    expect(trajectory.steps[0].probeEvidence.url).toBe("https://example.com");
  });
});
