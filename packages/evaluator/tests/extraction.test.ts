import { unresolvedChecks } from "../src/outcomeChecks.js";
import { expect, test } from "vitest";
import { RubricVerifier } from "../src/rubricVerifier.js";
import { loadTrajectoryFromDisk } from "../src/trajectory.js";
import type { CompletionRequest, LLMClient } from "../src/client.js";
import type { Trajectory } from "../src/types.js";

test.skipIf(!process.env.EVALUATOR_UPSTREAM_MODULE)(
  "preserves pinned result fields while adding explicit outcome state",
  async () => {
    const upstreamPath = process.env.EVALUATOR_UPSTREAM_MODULE;
    if (!upstreamPath)
      throw new Error(
        "Set EVALUATOR_UPSTREAM_MODULE to the pinned rubricVerifier.js for the extraction parity check",
      );
    const upstream = await import(upstreamPath);
    const trajectory: Trajectory = {
      task: {
        id: "parity",
        instruction: "Find the blue widget price",
        precomputedRubric: {
          items: [
            { criterion: "price", description: "Report the blue widget price", maxPoints: 1 },
          ],
        },
      },
      steps: [
        {
          actionName: "stagehand.snapshot",
          actionArgs: {},
          reasoning: "read price",
          probeEvidence: { ariaTree: "Blue widget $12", url: "https://example.test" },
          agentEvidence: { modalities: [{ type: "text", content: "Blue widget $12" }] },
          toolOutput: { ok: true, result: "Blue widget $12" },
        },
      ],
      finalAnswer: "$12",
      status: "complete",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const makeClient = () => {
      const requests: unknown[] = [];
      const client: LLMClient = {
        async createChatCompletion<T>(request: CompletionRequest): Promise<T> {
          requests.push(request.options.messages);
          const data =
            request.options.response_model.name === "BatchedRelevance"
              ? {
                  items: [0, 1, 2].map((evidence_idx) => ({
                    evidence_idx,
                    scores: [{ criterion_idx: 0, score: 10 }],
                  })),
                }
              : {
                  outcome: {
                    checks: Object.fromEntries(
                      Object.keys(unresolvedChecks()).map((k) => [
                        k,
                        { state: "supported", requirement: "price", evidence: "step 0" },
                      ]),
                    ),
                    primary_intent: "Find price",
                    reasoning: "Price matches",
                    output_success: true,
                    state: "supported",
                    findings: [],
                  },
                  per_criterion: [
                    { criterion_idx: 0, earned_points: 1, evidence_sufficient: true },
                  ],
                  task_validity: { is_ambiguous: false, is_invalid: false },
                };
          return { data } as T;
        },
      };
      return { requests, client };
    };
    const before = makeClient(),
      after = makeClient();
    const config = {
      evidenceMode: "legacy" as const,
      approach: "b" as const,
      optionalSteps: "folded" as const,
    };
    const oldResult = await new upstream.RubricVerifier({
      getClient: () => before.client,
      config,
    }).verify(trajectory);
    const newResult = await new RubricVerifier({ getClient: () => after.client, config }).verify(
      trajectory,
    );
    expect(after.requests).toHaveLength(before.requests.length);
    expect(newResult).toMatchObject(oldResult);
    expect(newResult.outcomeSuccess).toBe(true);
  },
);

test("loads existing disk trajectories without a browser", async () => {
  if (!process.env.EVALUATOR_REPLAY_DIR) return;
  const trajectory = await loadTrajectoryFromDisk(process.env.EVALUATOR_REPLAY_DIR);
  expect(trajectory.task.id).toBeTruthy();
  expect(Array.isArray(trajectory.steps)).toBe(true);
});
