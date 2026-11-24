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

const OPENROUTER_PREFIX = "openrouter/";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * An `openrouter/<vendor>/<model>` judge runs on the evaluator's OpenAI client
 * pointed at OpenRouter's OpenAI-compatible API, so a run needs no key from the
 * judge's own vendor. Returns undefined for every other model id.
 */
export function resolveOpenRouterVerifier(
  modelName: string,
  env: NodeJS.ProcessEnv = process.env,
): { modelName: string; modelClientOptions: { apiKey: string; baseURL: string } } | undefined {
  if (!modelName.startsWith(OPENROUTER_PREFIX)) return undefined;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`Verifier model is "${modelName}", but OPENROUTER_API_KEY is not set.`);
  }
  return {
    modelName: `openai/${modelName.slice(OPENROUTER_PREFIX.length)}`,
    modelClientOptions: { apiKey, baseURL: OPENROUTER_BASE_URL },
  };
}
