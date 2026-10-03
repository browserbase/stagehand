import { describe, expect, it } from "vitest";
import { DATASET_STEP_BUDGETS, resolveStepBudget } from "../../framework/stepBudget.js";

describe("resolveStepBudget", () => {
  it("prefers the harness-specific env key over everything else", () => {
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_CODEX_MAX_STEPS",
        dataset: "hardbenchmark",
        harnessDefault: 100,
        env: { EVAL_CODEX_MAX_STEPS: "12", AGENT_EVAL_MAX_STEPS: "34" },
      }),
    ).toBe(12);
  });

  it("falls back to AGENT_EVAL_MAX_STEPS before the dataset budget", () => {
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_CODEX_MAX_STEPS",
        dataset: "hardbenchmark",
        harnessDefault: 100,
        env: { AGENT_EVAL_MAX_STEPS: "34" },
      }),
    ).toBe(34);
  });

  it("applies the dataset budget when no env override is set", () => {
    expect(DATASET_STEP_BUDGETS.hardbenchmark).toBe(100);
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_EVE_MAX_STEPS",
        dataset: "hardbenchmark",
        harnessDefault: 50,
        env: {},
      }),
    ).toBe(100);
  });

  it("keeps the harness default for datasets without a budget", () => {
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_EVE_MAX_STEPS",
        dataset: "webvoyager",
        harnessDefault: 50,
        env: {},
      }),
    ).toBe(50);
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_CLAUDE_CODE_MAX_TURNS",
        dataset: undefined,
        harnessDefault: 50,
        env: {},
      }),
    ).toBe(50);
  });

  it("ignores non-positive and non-numeric env values", () => {
    expect(
      resolveStepBudget({
        harnessEnvKey: "EVAL_FX_MAX_STEPS",
        dataset: "hardbenchmark",
        harnessDefault: 60,
        env: { EVAL_FX_MAX_STEPS: "0", AGENT_EVAL_MAX_STEPS: "lots" },
      }),
    ).toBe(100);
  });
});
