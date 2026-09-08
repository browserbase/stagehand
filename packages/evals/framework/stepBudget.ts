/** Env var honored by every external harness when its own key is unset. */
export const SHARED_STEP_BUDGET_ENV = "AGENT_EVAL_MAX_STEPS";

/**
 * Per-dataset execution budgets. Reaching a budget records step_budget;
 * the verifier still determines task completion from the captured evidence.
 */
export const DATASET_STEP_BUDGETS: Readonly<Record<string, number | undefined>> = {
  hardbenchmark: 100,
};

export interface ResolveStepBudgetInput {
  /** Harness-specific env key (e.g. EVAL_CODEX_MAX_STEPS, EVAL_CLAUDE_CODE_MAX_TURNS). */
  harnessEnvKey: string;
  dataset: string | undefined;
  /** The harness's historical default, used when no env or dataset budget applies. */
  harnessDefault: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the agent step budget for one run. Precedence:
 * harness env key → AGENT_EVAL_MAX_STEPS → DATASET_STEP_BUDGETS[dataset] → harnessDefault.
 *
 * The unit is whatever the harness counts (tool steps for most, turns for
 * claude_code and pi). A shared number does not equate those units; runners
 * record the effective value and unit for comparison.
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
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
