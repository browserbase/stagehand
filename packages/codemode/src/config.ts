import type { StagehandCodeRuntimeConfig } from "./types.js";

export function runtimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StagehandCodeRuntimeConfig {
  const explicitModelName = nonEmpty(env.STAGEHAND_MODEL_NAME);
  const explicitModelApiKey = nonEmpty(env.STAGEHAND_MODEL_API_KEY);
  const inferredGoogleKey =
    nonEmpty(env.GEMINI_API_KEY) ??
    nonEmpty(env.GOOGLE_API_KEY) ??
    nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY);
  const modelName =
    explicitModelName ?? (inferredGoogleKey ? "google/gemini-2.5-flash-lite" : undefined);
  const modelApiKey = explicitModelApiKey ?? inferredGoogleKey;

  return {
    browserbaseApiKey: nonEmpty(env.BROWSERBASE_API_KEY),
    ...(modelName
      ? {
          model: {
            modelName,
            ...(modelApiKey ? { apiKey: modelApiKey } : {}),
            ...(nonEmpty(env.STAGEHAND_MODEL_BASE_URL)
              ? { baseURL: nonEmpty(env.STAGEHAND_MODEL_BASE_URL)! }
              : {}),
          },
        }
      : {}),
    ...(positiveInt(env.CODEMODE_DEFAULT_TIMEOUT_MS)
      ? { defaultTimeoutMs: positiveInt(env.CODEMODE_DEFAULT_TIMEOUT_MS) }
      : {}),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
