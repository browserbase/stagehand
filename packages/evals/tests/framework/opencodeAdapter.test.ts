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
            type: "assistant",
            content: [
              { type: "reasoning", text: "Inspect first" },
              {
                type: "tool",
                id: "call-1",
                name: "stagehand_run",
                state: {
                  status: "completed",
                  input: { code: "return 1" },
                  content: [{ type: "text", text: "1" }],
                },
              },
              { type: "tool", id: "call-1", name: "stagehand_run", state: { status: "completed" } },
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
      toolOutput: { ok: true, result: [{ type: "text", text: "1" }] },
    });
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.finalAnswer).toBe("finished");
  });

  it("marks unmatched calls as missing results and keys evidence by tool-call id", () => {
    const trajectory = opencodeAdapter.fromHarnessResult(
      {
        messages: [
          {
            type: "assistant",
            content: [
              { type: "tool", id: "open", name: "stagehand_run", state: { status: "running", input: {} } },
              {
                type: "tool",
                id: "shot",
                name: "stagehand_screenshot",
                state: {
                  status: "completed",
                  input: {},
                  content: [
                    { type: "file", mime: "image/png", uri: "data:image/png;base64,aW1hZ2U=" },
                  ],
                },
              },
              {
                type: "tool",
                id: "other",
                name: "stagehand_run",
                state: { status: "completed", input: {}, content: [{ type: "text", text: "later" }] },
              },
            ],
          },
        ],
        observedToolName: (name) => name.startsWith("stagehand_"),
        stepObservations: [
          { runIndex: 0, toolCallId: "shot", evidence: { url: "https://example.com" } },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps).toHaveLength(3);
    expect(trajectory.steps[0].toolOutput).toMatchObject({ ok: false, result: "no tool result" });
    expect(trajectory.steps[1].toolOutput.ok).toBe(true);
    expect(trajectory.steps[1].agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        { type: "image", bytes: Buffer.from("image"), mediaType: "image/png" },
      ]),
    );
    expect(trajectory.steps[1].probeEvidence.url).toBe("https://example.com");
    expect(trajectory.steps[2].probeEvidence?.url).toBeUndefined();
  });
});
