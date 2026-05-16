import { describe, expect, it } from "vitest";
import type { EvaluationResult } from "@browserbasehq/stagehand";

import {
  evaluationResultToSuccess,
  resolveEvalSuccessMode,
} from "../../framework/verifierAdapter.js";

const baseResult: EvaluationResult = {
  outcomeSuccess: true,
  processScore: 0.5,
  perCriterion: [],
  taskValidity: { isAmbiguous: false, isInvalid: false },
  evidenceInsufficient: [],
};

describe("resolveEvalSuccessMode", () => {
  it("defaults invalid env/config values to outcome", () => {
    expect(resolveEvalSuccessMode(undefined)).toBe("outcome");
    expect(resolveEvalSuccessMode("bad-value")).toBe("outcome");
    expect(resolveEvalSuccessMode(" PROCESS ")).toBe("process");
  });
});

describe("evaluationResultToSuccess", () => {
  it("uses validated success modes", () => {
    expect(evaluationResultToSuccess(baseResult, "outcome")).toBe(true);
    expect(evaluationResultToSuccess(baseResult, "process")).toBe(false);
    expect(evaluationResultToSuccess(baseResult, "both")).toBe(false);
    expect(evaluationResultToSuccess(baseResult, "invalid")).toBe(true);
  });

  it("treats missing process score as a failed process gate", () => {
    const outcomeOnly: EvaluationResult = { outcomeSuccess: true };
    expect(evaluationResultToSuccess(outcomeOnly, "outcome")).toBe(true);
    expect(evaluationResultToSuccess(outcomeOnly, "process")).toBe(false);
    expect(evaluationResultToSuccess(outcomeOnly, "both")).toBe(false);
  });
});
