/**
 * Effective judge model for the rubric verifier.
 *
 * Dependency-free so the CLI header can print the judge without loading the
 * evaluator. `verifierAdapter.ts` consumes the same resolution, so the CLI
 * never reports a judge the run did not use.
 */

export const VERIFIER_MODEL_ENV = "EVAL_VERIFIER_MODEL";

/**
 * V3Evaluator's built-in default (google/gemini-2.5-flash) was retired
 * 2026-07-09; leaving it in place fails every rubric criterion silently
 * ("Fused judgment call failed"), which scores whole runs as unscored.
 */
export const DEFAULT_VERIFIER_MODEL = "google/gemini-3.5-flash";

export function resolveVerifierModel(env: NodeJS.ProcessEnv = process.env): {
  modelName: string;
  source: "env" | "default";
} {
  const explicitModel = env[VERIFIER_MODEL_ENV]?.trim();
  return explicitModel
    ? { modelName: explicitModel, source: "env" }
    : { modelName: DEFAULT_VERIFIER_MODEL, source: "default" };
}
