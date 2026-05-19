import { afterEach, describe, expect, it, vi } from "vitest";

import { RubricVerifier } from "../../lib/v3/verifier/rubricVerifier.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { TaskSpec, Trajectory } from "../../lib/v3/verifier/types.js";

describe("RubricVerifier", () => {
  const previousEnv = {
    approach: process.env.VERIFIER_APPROACH,
    retries: process.env.VERIFIER_RUBRIC_RETRIES,
    requireTaskSpan: process.env.VERIFIER_RUBRIC_REQUIRE_TASK_SPAN,
  };

  afterEach(() => {
    restoreEnv("VERIFIER_APPROACH", previousEnv.approach);
    restoreEnv("VERIFIER_RUBRIC_RETRIES", previousEnv.retries);
    restoreEnv(
      "VERIFIER_RUBRIC_REQUIRE_TASK_SPAN",
      previousEnv.requireTaskSpan,
    );
  });

  it("retries rubric generation and filters criteria outside the task span", async () => {
    process.env.VERIFIER_RUBRIC_RETRIES = "2";
    const createChatCompletion = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary parse failure"))
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              criterion: "Identify the most recent paper",
              task_span: "most recent paper",
              description:
                "Full credit for identifying the most recent relevant paper.",
              max_points: 4,
              justification: "",
              earned_points: "",
            },
            {
              criterion: "Output the abstract",
              task_span: "abstract",
              description: "This criterion is not requested by the task.",
              max_points: 1,
              justification: "",
              earned_points: "",
            },
          ],
        },
      });
    const verifier = new RubricVerifier({
      getClient: () => throwingClient(),
      getRubricGenClient: () =>
        ({ createChatCompletion }) as unknown as LLMClient,
      logger: vi.fn(),
    });

    const rubric = await verifier.generateRubric({
      id: "arxiv",
      instruction:
        "Search arXiv for the most recent paper on retrieval-augmented generation.",
    });

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(rubric).toEqual({
      items: [
        {
          criterion: "Identify the most recent paper",
          description:
            "Full credit for identifying the most recent relevant paper.",
          maxPoints: 4,
        },
      ],
    });
  });

  it("supports outcome-only verification without generating a rubric", async () => {
    process.env.VERIFIER_APPROACH = "outcome-only";
    const createChatCompletion = vi.fn().mockResolvedValue({
      data: {
        outcome: {
          primary_intent: "Complete the task",
          reasoning: "The final page and answer show completion.",
          output_success: true,
          findings: [],
        },
        task_validity: {
          is_ambiguous: false,
          ambiguity_reason: "",
          is_invalid: false,
          invalid_reason: "",
        },
      },
    });
    const verifier = new RubricVerifier({
      getClient: () => ({ createChatCompletion }) as unknown as LLMClient,
      getRubricGenClient: () => throwingClient(),
    });
    const taskSpec: TaskSpec = {
      id: "outcome",
      instruction: "Complete the task",
    };

    const result = await verifier.verify(
      makeTrajectory(taskSpec, Buffer.from("screenshot")),
    );

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcomeSuccess: true,
      explanation: "The final page and answer show completion.",
      rawSteps: {
        approach: "outcome-only",
        screenshotsAttached: 1,
      },
    });
    expect(result.processScore).toBeUndefined();
    expect(result.perCriterion).toBeUndefined();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function throwingClient(): LLMClient {
  return {
    createChatCompletion: vi.fn().mockRejectedValue(new Error("unexpected")),
  } as unknown as LLMClient;
}

function makeTrajectory(task: TaskSpec, screenshot: Buffer): Trajectory {
  return {
    task,
    steps: [
      {
        index: 0,
        actionName: "act",
        actionArgs: {},
        reasoning: "I completed the task.",
        agentEvidence: { modalities: [] },
        probeEvidence: { screenshot },
        toolOutput: { ok: true, result: "done" },
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
      },
    ],
    finalAnswer: "Done.",
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
