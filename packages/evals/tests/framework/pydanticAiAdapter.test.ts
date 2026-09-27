import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import { pydanticAiAdapter } from "../../framework/harnesses/pydanticAiAdapter.js";

const taskSpec: TaskSpec = {
  id: "task-1",
  instruction: "click",
  initUrl: "https://example.com",
};

describe("Pydantic AI trajectory adapter", () => {
  it("pairs calls and results, preserving reasoning, structure, and images", () => {
    const trajectory = pydanticAiAdapter.fromHarnessResult(
      {
        events: [
          { type: "assistant", text: "inspect first" },
          { type: "tool_call", id: "1", name: "snapshot", server: "stagehand", args: { x: 1 } },
          {
            type: "tool_result",
            id: "1",
            name: "snapshot",
            server: "stagehand",
            ok: true,
            text: "fallback",
            structured: { page: "ok" },
            images: [{ data: "YWJj", mime_type: "image/png" }],
          },
          { type: "assistant", text: "finished" },
          { type: "final", text: "final answer" },
        ],
      },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "stagehand.snapshot",
      actionArgs: { x: 1 },
      reasoning: "inspect first",
      toolOutput: { ok: true, result: { page: "ok" } },
    });
    expect(trajectory.steps[0]?.agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          mediaType: "image/png",
          bytes: Buffer.from("abc"),
        }),
      ]),
    );
    expect(trajectory.finalAnswer).toBe("final answer");
  });

  it("surfaces unmatched results, unfinished calls, and errors", () => {
    const trajectory = pydanticAiAdapter.fromHarnessResult(
      {
        events: [
          { type: "tool_call", id: "open", name: "run", args: {} },
          { type: "tool_result", id: "other", name: "orphan", ok: false, text: "failed" },
          { type: "error", message: "limit" },
          { type: "assistant", text: "fallback answer" },
        ],
      },
      taskSpec,
    );
    expect(trajectory.steps.map((step) => step.actionName)).toEqual(["run", "orphan", "error"]);
    expect(trajectory.steps[0]?.toolOutput.error).toBe("no tool result");
    expect(trajectory.steps[1]?.toolOutput.error).toBe("failed");
    expect(trajectory.finalAnswer).toBe("fallback answer");
  });
});
