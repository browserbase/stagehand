import { describe, expect, it, vi } from "vitest";

import { V3Evaluator } from "../../lib/v3Evaluator.js";
import type { V3 } from "../../lib/v3/v3.js";
import type { TaskSpec, Trajectory } from "../../lib/v3/verifier/index.js";

describe("V3Evaluator verifier facade", () => {
  it("rejects verifier backend before the verifier PR is installed", async () => {
    const evaluator = new V3Evaluator({} as V3, {
      backend: "verifier",
    });

    await expect(
      evaluator.ask({ question: "Was the task completed?" }),
    ).rejects.toThrow(
      "STAGEHAND_EVALUATOR_BACKEND=verifier, but the verifier backend is not available",
    );
  });

  it("rejects verify when the verifier backend is selected before the verifier PR is installed", async () => {
    const taskSpec: TaskSpec = {
      id: "verifier-unavailable",
      instruction: "Complete the task",
    };
    const evaluator = new V3Evaluator({} as V3, {
      backend: "verifier",
    });

    await expect(
      evaluator.verify(makeTrajectory(taskSpec), taskSpec),
    ).rejects.toThrow(
      "STAGEHAND_EVALUATOR_BACKEND=verifier, but the verifier backend is not available",
    );
  });

  it("rejects generateRubric when the verifier backend is selected before the verifier PR is installed", async () => {
    const evaluator = new V3Evaluator({} as V3, {
      backend: "verifier",
    });

    await expect(
      evaluator.generateRubric({
        id: "rubric-unavailable",
        instruction: "Complete the task",
      }),
    ).rejects.toThrow(
      "STAGEHAND_EVALUATOR_BACKEND=verifier, but the verifier backend is not available",
    );
  });

  it("maps legacy YES evaluations with trajectory screenshots to a successful result", async () => {
    const taskSpec: TaskSpec = {
      id: "success",
      instruction: "Complete the task",
    };
    const screenshot = Buffer.from("screenshot");
    const trajectory = makeTrajectory(taskSpec, {
      screenshot,
      finalAnswer: "The task is complete.",
    });
    const ask = vi.fn().mockResolvedValue({
      evaluation: "YES",
      reasoning: "The screenshot shows completion.",
    });
    const evaluator = new V3Evaluator({} as V3, {
      backend: "legacy",
    });
    Object.defineProperty(evaluator, "legacyEvaluator", {
      value: { ask },
    });

    const result = await evaluator.verify(trajectory, taskSpec);

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        question: taskSpec.instruction,
        screenshot: [screenshot],
        answer: "The task is complete.",
      }),
    );
    expect(result.outcomeSuccess).toBe(true);
    expect(result.explanation).toBe("The screenshot shows completion.");
    expect(result.processScore).toBeUndefined();
    expect(result.perCriterion).toBeUndefined();
  });

  it("keeps legacy tool output detail until the overall reasoning budget is reached", async () => {
    const taskSpec: TaskSpec = {
      id: "reasoning-budget",
      instruction: "Complete the task",
    };
    const longToolOutput = "x".repeat(3000);
    const ask = vi.fn().mockResolvedValue({
      evaluation: "YES",
      reasoning: "The trajectory shows completion.",
    });
    const evaluator = new V3Evaluator({} as V3, {
      backend: "legacy",
    });
    Object.defineProperty(evaluator, "legacyEvaluator", {
      value: { ask },
    });

    await evaluator.verify(
      makeTrajectory(taskSpec, {
        finalAnswer: "The task is complete.",
        toolResult: longToolOutput,
      }),
      taskSpec,
    );

    const firstCall = ask.mock.calls[0]?.[0];
    expect(firstCall?.agentReasoning).toContain(longToolOutput);
    expect(firstCall?.agentReasoning).not.toContain("Final answer:");
    expect(firstCall?.answer).toBe("The task is complete.");
  });

  it("returns an evidence-insufficient legacy result for empty trajectories", async () => {
    const taskSpec: TaskSpec = {
      id: "empty",
      instruction: "Complete the task",
    };
    const evaluator = new V3Evaluator({} as V3, {
      backend: "legacy",
    });

    const result = await evaluator.verify(
      makeEmptyTrajectory(taskSpec),
      taskSpec,
    );

    expect(result).toMatchObject({
      outcomeSuccess: false,
      explanation:
        "Legacy evaluator compatibility mode had no screenshots or final answer to evaluate.",
      rawSteps: {
        backend: "legacy",
        legacyEvaluation: "INVALID",
        screenshotCount: 0,
      },
    });
    expect(result.processScore).toBeUndefined();
    expect(result.perCriterion).toBeUndefined();
  });

  it("rejects invalid evaluator backend env values", () => {
    const previousBackend = process.env.STAGEHAND_EVALUATOR_BACKEND;
    process.env.STAGEHAND_EVALUATOR_BACKEND = "not-a-backend";

    try {
      expect(() => new V3Evaluator({} as V3)).toThrow(
        'Invalid STAGEHAND_EVALUATOR_BACKEND="not-a-backend"',
      );
    } finally {
      if (previousBackend === undefined) {
        delete process.env.STAGEHAND_EVALUATOR_BACKEND;
      } else {
        process.env.STAGEHAND_EVALUATOR_BACKEND = previousBackend;
      }
    }
  });
});

function makeEmptyTrajectory(taskSpec: TaskSpec): Trajectory {
  return {
    task: taskSpec,
    steps: [],
    status: "complete",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
    timing: {
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
    },
  };
}

function makeTrajectory(
  taskSpec: TaskSpec,
  options: {
    screenshot?: Buffer;
    finalAnswer?: string;
    toolResult?: unknown;
  } = {},
): Trajectory {
  return {
    ...makeEmptyTrajectory(taskSpec),
    steps: [
      {
        index: 0,
        actionName: "act",
        actionArgs: {},
        reasoning: "I completed the task.",
        agentEvidence: { modalities: [] },
        probeEvidence: options.screenshot
          ? { screenshot: options.screenshot }
          : {},
        toolOutput: {
          ok: true,
          result: options.toolResult ?? "done",
        },
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
      },
    ],
    finalAnswer: options.finalAnswer,
  };
}
