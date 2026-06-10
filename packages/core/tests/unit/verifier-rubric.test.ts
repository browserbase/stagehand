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

  it("always attaches the final probe screenshot and ariaTree to outcome verification", async () => {
    // Regression test: the apple_trade_in case where the answer ($305) was
    // visible in the final probe screenshot + ariaTree but the verifier called
    // it fabricated because the per-criterion top-K selection didn't pick the
    // final frame. The "always attach final state" path must guarantee the
    // judge sees both image bytes and the full final ariaTree.
    process.env.VERIFIER_APPROACH = "outcome-only";
    const seenPrompt = vi.fn<(prompt: string) => void>();
    const seenImageBytesLengths = vi.fn<(count: number) => void>();
    const createChatCompletion = vi.fn().mockImplementation((args) => {
      const userMsg = args.options.messages[1];
      const parts = Array.isArray(userMsg.content)
        ? userMsg.content
        : [{ type: "text", text: userMsg.content }];
      const text = parts
        .filter((p: { type: string }) => p.type === "text")
        .map((p: { text: string }) => p.text)
        .join("\n");
      const images = parts.filter(
        (p: { type: string }) => p.type === "image_url",
      );
      seenPrompt(text);
      seenImageBytesLengths(images.length);
      return Promise.resolve({
        data: {
          outcome: {
            primary_intent: "Find the trade-in value",
            reasoning: "The final screenshot shows the value.",
            output_success: true,
            findings: [],
          },
        },
      });
    });

    const verifier = new RubricVerifier({
      getClient: () => ({ createChatCompletion }) as unknown as LLMClient,
      getRubricGenClient: () => throwingClient(),
    });
    const taskSpec: TaskSpec = {
      id: "apple_trade_in",
      instruction: "Find the trade-in value for an iPhone 13 Pro Max.",
    };

    // Final state lives ONLY on probeEvidence (not in agentEvidence) — this is
    // the configuration that previously starved the verifier of the answer.
    const finalScreenshot = Buffer.from(
      "final-page-with-$305-trade-in-value-bytes",
    );
    const finalAria =
      "RootWebArea: Apple Trade In\n  heading: Get $305 trade-in credit toward a new iPhone.\n  StaticText: Trade-in values are estimates";
    const trajectory: Trajectory = {
      task: taskSpec,
      steps: [
        {
          actionName: "click",
          actionArgs: { describe: "Yes option for good condition" },
          reasoning: "Click Yes to confirm good condition.",
          agentEvidence: { modalities: [] },
          probeEvidence: {
            screenshot: finalScreenshot,
            ariaTree: finalAria,
            url: "https://www.apple.com/shop/trade-in",
          },
          toolOutput: { ok: true, result: "clicked" },
        },
      ],
      finalAnswer: "The trade-in value is $305.",
      status: "complete",
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    await verifier.verify(trajectory);

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(seenImageBytesLengths).toHaveBeenCalledWith(1);
    const prompt = seenPrompt.mock.calls[0][0];
    // The "$" survives renderPrompt's $$-escaping because we render literal
    // ariaTree content into the prompt unescaped.
    expect(prompt).toContain("Final trajectory state");
    expect(prompt).toContain("Get $305 trade-in credit toward a new iPhone.");
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
        actionName: "act",
        actionArgs: {},
        reasoning: "I completed the task.",
        agentEvidence: { modalities: [] },
        probeEvidence: { screenshot },
        toolOutput: { ok: true, result: "done" },
      },
    ],
    finalAnswer: "Done.",
    status: "complete",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}
