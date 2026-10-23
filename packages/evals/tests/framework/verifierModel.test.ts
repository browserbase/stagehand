import { describe, expect, it } from "vitest";
import * as evaluator from "@browserbasehq/stagehand-evaluator";

import { DEFAULT_VERIFIER_MODEL, resolveVerifierModel } from "../../framework/verifierModel.js";

describe("verifierModel", () => {
  it("reports the same default judge the evaluator uses", () => {
    expect(DEFAULT_VERIFIER_MODEL).toBe(evaluator.DEFAULT_VERIFIER_MODEL);
  });

  it("prefers EVAL_VERIFIER_MODEL over the default", () => {
    expect(resolveVerifierModel({ EVAL_VERIFIER_MODEL: " openai/gpt-6-luna " })).toEqual({
      modelName: "openai/gpt-6-luna",
      source: "env",
    });
    expect(resolveVerifierModel({})).toEqual({
      modelName: evaluator.DEFAULT_VERIFIER_MODEL,
      source: "default",
    });
  });
});
