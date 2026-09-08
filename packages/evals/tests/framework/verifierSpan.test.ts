import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationResult, Trajectory } from "stagehand-v3";
import { verifyTraced } from "../../framework/verifierAdapter.js";

const log = vi.hoisted(() => vi.fn());
vi.mock("../../framework/braintrust.js", () => ({
  tracedSpan: async (fn: (span: { log: typeof log }) => Promise<unknown>) => fn({ log }),
}));

describe("verifier child-span grading", () => {
  beforeEach(() => log.mockClear());

  it("retains raw uncertainty with ungraded metadata and no synthetic scores", async () => {
    const result = {
      outcomeSuccess: false,
      processScore: 0,
      findings: [{ category: "verifier_uncertainty", description: "provider unavailable" }],
    } as EvaluationResult;
    expect(await verify(result)).toBe(result);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ output: result, metadata: { graded: false } });
    expect(log.mock.calls[0][0].metadata.verifierError).toContain("uncertainty");
    expect(log.mock.calls[0][0]).not.toHaveProperty("scores");
  });

  it.each([false, true])("records trustworthy outcome=%s scores", async (outcomeSuccess) => {
    const result = { outcomeSuccess, processScore: 0.5 } as EvaluationResult;
    await verify(result);
    expect(log.mock.calls[0][0]).toMatchObject({
      output: result,
      scores: { outcome: outcomeSuccess ? 1 : 0, process: 0.5 },
      metadata: { graded: true },
    });
  });
});

function verify(result: EvaluationResult) {
  return verifyTraced({ verify: async () => result }, { steps: [] } as unknown as Trajectory, {
    taskId: "fixture",
    dataset: "fixture",
  });
}
