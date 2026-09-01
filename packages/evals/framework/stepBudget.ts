import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";

/** Env var honored by every external harness when its own key is unset. */
export const SHARED_STEP_BUDGET_ENV = "AGENT_EVAL_MAX_STEPS";

/**
 * Per-dataset step budgets. HardBench tasks routinely need more browser steps
 * than the WebVoyager-era harness defaults (50-60) allow, and a run that dies
 * on budget is graded as a fail regardless of how close it got.
 */
export const DATASET_STEP_BUDGETS: Partial<Record<ExternalHarnessTaskPlan["dataset"], number>> = {
  hardbenchmark: 75,
};

export interface ResolveStepBudgetInput {
  /** Harness-specific env key (e.g. EVAL_CODEX_MAX_STEPS, EVAL_CLAUDE_CODE_MAX_TURNS). */
  harnessEnvKey: string;
  dataset: ExternalHarnessTaskPlan["dataset"] | undefined;
  /** The harness's historical default, used when no env or dataset budget applies. */
  harnessDefault: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the agent step budget for one run. Precedence:
 * harness env key → AGENT_EVAL_MAX_STEPS → DATASET_STEP_BUDGETS[dataset] → harnessDefault.
 *
 * The unit is whatever the harness counts (tool steps for most, turns for
 * claude_code and pi); the dataset budgets are calibrated for tool steps, and
 * turn-counting harnesses accept the slight over-allowance rather than a
 * second table.
 */
export function resolveStepBudget({
  harnessEnvKey,
  dataset,
  harnessDefault,
  env = process.env,
}: ResolveStepBudgetInput): number {
  for (const key of [harnessEnvKey, SHARED_STEP_BUDGET_ENV]) {
    const parsed = readPositiveInt(env[key]);
    if (parsed !== undefined) return parsed;
  }
  const datasetBudget = dataset ? DATASET_STEP_BUDGETS[dataset] : undefined;
  return datasetBudget ?? harnessDefault;
}

function readPositiveInt(raw: string | undefined): number | undefined {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
