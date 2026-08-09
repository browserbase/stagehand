import { describe, expect, it } from "vitest";
import type { TaskSpec } from "@browserbasehq/stagehand";
import { bareLoopAdapter } from "../../framework/harnesses/bareLoopAdapter.js";
import type { NormalizedToolCall } from "../../framework/harnesses/trajectoryAdapter.js";

const taskSpec: TaskSpec = {
  id: "wtb-1",
  instruction: "Find the checkout button",
  initUrl: "https://example.com",
};

describe("bareLoopAdapter", () => {
  it("passes recorded tool calls through to trajectory steps", () => {
    const toolCalls: NormalizedToolCall[] = [
      {
        name: "browse",
        args: { args: "--help" },
        result: "usage: browse ...",
        ok: true,
        reasoning: "Read the help first.",
      },
      {
        name: "browse",
        args: { args: "bogus" },
        result: "ERROR: unknown command",
        ok: false,
        error: "ERROR: unknown command",
      },
    ];

    const trajectory = bareLoopAdapter.fromHarnessResult(
      {
        toolCalls,
        finalAnswer: "checkout",
        status: "complete",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      taskSpec,
    );

    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[0].actionName).toBe("browse");
    expect(trajectory.steps[0].reasoning).toBe("Read the help first.");
    expect(trajectory.steps[0].toolOutput?.ok).toBe(true);
    expect(trajectory.steps[1].toolOutput?.ok).toBe(false);
    expect(trajectory.finalAnswer).toBe("checkout");
    expect(trajectory.status).toBe("complete");
    expect(trajectory.usage.input_tokens).toBe(100);
    expect(trajectory.usage.output_tokens).toBe(20);
  });

  it("defaults status to complete and tolerates an empty run", () => {
    const trajectory = bareLoopAdapter.fromHarnessResult(
      { toolCalls: [] },
      taskSpec,
    );
    expect(trajectory.status).toBe("complete");
    expect(trajectory.steps).toHaveLength(0);
    expect(trajectory.finalAnswer).toBeUndefined();
  });
});
