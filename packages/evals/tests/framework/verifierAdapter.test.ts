import { afterEach, describe, expect, it } from "vitest";
import { V3, type EvaluationResult } from "stagehand-v3";
import { EvalLogger } from "../../logger.js";

import {
  gradeExternalTrajectory,
  evaluationResultToSuccess,
  createVerifierEvaluator,
  loadVerifierApiKey,
  resolveEvalSuccessMode,
} from "../../framework/verifierAdapter.js";

afterEach(() => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.EVAL_VERIFIER_MODEL;
});

describe("loadVerifierApiKey", () => {
  it("maps the AI SDK gateway provider to the Vercel AI Gateway key", () => {
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
    expect(loadVerifierApiKey("gateway")).toBe("test-gateway-key");
  });

  it("does not treat an empty gateway key as configured", () => {
    process.env.AI_GATEWAY_API_KEY = "  ";
    expect(loadVerifierApiKey("gateway")).toBeUndefined();
  });

  it("initializes the OnlineMind2Web Gemini verifier through Vercel Gateway", async () => {
    process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
    process.env.EVAL_VERIFIER_MODEL = "gateway/google/gemini-2.5-flash";
    const carrier = new V3({
      env: "LOCAL",
      disablePino: true,
      disableAPI: true,
      experimental: true,
      verbose: 0,
    });
    try {
      expect(createVerifierEvaluator(carrier)).toBeDefined();
    } finally {
      await carrier.close();
    }
  });
});

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

describe("gradeExternalTrajectory", () => {
  it("can fail closed when trajectory parsing or verification fails", async () => {
    const logger = new EvalLogger(true);
    const carrier = new V3({
      env: "LOCAL",
      disablePino: true,
      disableAPI: true,
      experimental: true,
      verbose: 0,
    });
    logger.init(carrier);
    try {
      const result = await gradeExternalTrajectory({
        buildTrajectory: () => {
          throw new Error("incomplete trace");
        },
        verifier: {
          v3: carrier,
          taskSpec: { id: "task-1", instruction: "Inspect the page." },
          dataset: "onlineMind2Web",
        },
        baseResult: { _success: true, logs: [] },
        errorMessage: "rubric failed",
        category: "hermes",
        logger,
        failClosedOnVerifierError: true,
      });
      expect(result._success).toBe(false);
      expect(result.verifierError).toContain("incomplete trace");
    } finally {
      await carrier.close();
    }
  });
});
