/**
 * Effective judge model for the rubric verifier.
 *
 * Dependency-free so the CLI header can print the judge without loading the
 * evaluator. `verifierAdapter.ts` consumes the same resolution, so the CLI
 * never reports a judge the run did not use.
 */

export const VERIFIER_MODEL_ENV = "EVAL_VERIFIER_MODEL";

/**
 * Mirrors DEFAULT_VERIFIER_MODEL in @browserbasehq/stagehand-evaluator, the
 * judge the evaluator was calibrated on. Kept as a literal so this module stays
 * dependency-free; verifierModel.test.ts pins the two together.
 */
export const DEFAULT_VERIFIER_MODEL = "google/gemini-3.8-flash";

export function resolveVerifierModel(env: NodeJS.ProcessEnv = process.env): {
  modelName: string;
  source: "env" | "default";
} {
  const explicitModel = env[VERIFIER_MODEL_ENV]?.trim();
  return explicitModel
    ? { modelName: explicitModel, source: "env" }
    : { modelName: DEFAULT_VERIFIER_MODEL, source: "default" };
}
