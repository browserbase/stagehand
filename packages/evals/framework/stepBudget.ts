export const SHARED_STEP_BUDGET_ENV = "AGENT_EVAL_MAX_STEPS";

export const DATASET_STEP_BUDGETS: Readonly<Record<string, number | undefined>> = {
  hardbenchmark: 100,
};

export interface ResolveStepBudgetInput {
  harnessEnvKey: string;
  dataset: string | undefined;
  harnessDefault: number;
  env?: NodeJS.ProcessEnv;
}

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
