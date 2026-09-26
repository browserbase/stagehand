import { describe, expect, it } from "vitest";
import { unrealAgentTrajectory } from "../../framework/harnesses/unrealAgentAdapter.js";

describe("Unreal Agent trajectory", () => {
  it("retains upstream Bash calls and associates facade evidence with browser steps", () => {
    const trajectory = unrealAgentTrajectory({
      taskSpec: { id: "test", instruction: "browse", initUrl: "https://example.com" },
      toolCalls: [
        { id: "1", name: "Bash", args: { command: "facade snapshot" }, status: "submitted" },
      ],
      facadeCalls: [
        { name: "snapshot", args: {}, result: { content: [{ type: "text", text: "page" }] } },
      ],
      finalAnswer: "done",
      status: "complete",
      usage: { input_tokens: 1, output_tokens: 2 },
      stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }],
    });
    expect(trajectory.steps.map((step) => step.actionName)).toEqual(["facade.snapshot"]);
    expect(trajectory.steps[0]?.probeEvidence.url).toBe("https://example.com");
    expect(trajectory.steps[0]?.toolOutput.result).toBe("page");
  });
});
