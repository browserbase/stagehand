import { expect, test } from "vitest";
import type { CompletionRequest, LLMClient } from "../src/client.js";
import { unresolvedChecks } from "../src/outcomeChecks.js";
import { RubricVerifier } from "../src/rubricVerifier.js";
import type { Trajectory } from "../src/types.js";

const outcome = {
  checks: unresolvedChecks(),
  state: "unresolved",
  output_success: false,
  primary_intent: "Buy widget",
  reasoning: "n/a",
  findings: [],
};

function client(calls: string[] = []): LLMClient {
  return {
    async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
      const name = request.options.response_model.name;
      calls.push(name);
      if (name === "PerCriterionScore") {
        const text = JSON.stringify(request.options.messages);
        const conditional = text.includes("Apply coupon");
        return {
          data: {
            criterion_idx: 0,
            earned_points: conditional ? 2 : 1,
            justification: conditional ? "no coupon offered" : "added",
            evidence_sufficient: true,
            condition_met: conditional ? false : null,
          },
        } as T;
      }
      return {
        data: {
          outcome,
          per_criterion: [{ criterion_idx: 0, earned_points: 0, justification: "none" }],
        },
      } as T;
    },
  };
}

const base = {
  task: {
    id: "widget",
    instruction: "Buy widget",
    precomputedRubric: {
      items: [
        { criterion: "Add widget", description: "Widget in cart", maxPoints: 2 },
        {
          criterion: "Apply coupon",
          description: "Coupon applied",
          maxPoints: 2,
          condition: "A coupon field is offered",
        },
      ],
    },
  },
  status: "complete",
  usage: { input_tokens: 0, output_tokens: 0 },
} satisfies Omit<Trajectory, "steps">;

test("approach a excludes condition_met=false criteria from both process totals", async () => {
  const verifier = new RubricVerifier({
    getClient: () => client(),
    config: { approach: "a", imageSelection: "recency", optionalSteps: "skip" },
  });
  const result = await verifier.verify({
    ...base,
    steps: [
      {
        actionName: "run",
        actionArgs: {},
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: { ariaTree: "Cart: widget" },
        toolOutput: { ok: true, result: "Cart: widget" },
      },
    ],
    finalAnswer: "Added widget",
  });
  expect(result.perCriterion[1]).toMatchObject({ earnedPoints: null, conditionMet: false });
  expect(result.processScore).toBe(0.5);
});

test("a zero-step run with only a final observation still reaches the judge", async () => {
  const calls: string[] = [];
  const verifier = new RubricVerifier({
    getClient: () => client(calls),
    config: { imageSelection: "recency", optionalSteps: "skip" },
  });
  const result = await verifier.verify({
    ...base,
    steps: [],
    finalObservation: { url: "https://example.com/cart", ariaTree: "Cart: widget" },
  });
  expect(calls).toContain("FusedJudgment");
  expect(result.rawSteps?.reason).not.toBe("empty-trajectory");
});

test("approach a shows answer-anchor evidence to every criterion", async () => {
  const prompts: string[] = [];
  const base_ = client();
  const verifier = new RubricVerifier({
    getClient: () => ({
      async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
        if (request.options.response_model.name === "PerCriterionScore")
          prompts.push(JSON.stringify(request.options.messages));
        return base_.createChatCompletion<T>(request);
      },
    }),
    config: { approach: "a", imageSelection: "recency", optionalSteps: "skip" },
  });
  await verifier.verify({
    ...base,
    steps: [
      // Criterion-relevant chunks fill each criterion's top-K, so only the anchor group carries the
      // chunk that holds the claimed price.
      ...Array.from({ length: 40 }, (_, i) => ({
        actionName: "run",
        actionArgs: {},
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: {},
        toolOutput: { ok: true, result: `Widget cart coupon field ${i}: add widget, apply coupon` },
      })),
      {
        actionName: "run",
        actionArgs: {},
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: {},
        toolOutput: { ok: true, result: "Grand total due today: $129.99" },
      },
    ],
    finalAnswer: "Bought the widget for $129.99",
  });
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) expect(prompt).toContain("Grand total due today");
});
