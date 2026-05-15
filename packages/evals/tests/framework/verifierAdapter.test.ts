import { describe, expect, it } from "vitest";
import type { Verdict } from "@browserbasehq/stagehand";

import {
  resolveEvalSuccessMode,
  verdictToSuccess,
} from "../../framework/verifierAdapter.js";

const baseVerdict: Verdict = {
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

describe("verdictToSuccess", () => {
  it("uses validated success modes", () => {
    expect(verdictToSuccess(baseVerdict, "outcome")).toBe(true);
    expect(verdictToSuccess(baseVerdict, "process")).toBe(false);
    expect(verdictToSuccess(baseVerdict, "both")).toBe(false);
    expect(verdictToSuccess(baseVerdict, "invalid")).toBe(true);
  });
});
