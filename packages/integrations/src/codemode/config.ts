import { StagehandClientCreateConfigSchema } from "@browserbasehq/stagehand";
import type { StagehandCodeConfig } from "./types.js";

export function stagehandCodeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StagehandCodeConfig {
  const requestedBrowser = nonEmpty(env.STAGEHAND_BROWSER)?.toLowerCase();
  if (
    requestedBrowser !== undefined &&
    requestedBrowser !== "local" &&
    requestedBrowser !== "browserbase"
  ) {
    throw new Error('STAGEHAND_BROWSER must be either "local" or "browserbase".');
  }

  const browserbaseApiKey = nonEmpty(env.BROWSERBASE_API_KEY);
  const browserType = requestedBrowser ?? (browserbaseApiKey ? "browserbase" : "local");
  if (browserType === "browserbase" && !browserbaseApiKey) {
    throw new Error('BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER="browserbase".');
  }

  const explicitModelName = nonEmpty(env.STAGEHAND_MODEL_NAME);
  const explicitModelApiKey = nonEmpty(env.STAGEHAND_MODEL_API_KEY);
  const inferredGoogleKey =
    nonEmpty(env.GEMINI_API_KEY) ??
    nonEmpty(env.GOOGLE_API_KEY) ??
    nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY);
  const modelName =
    explicitModelName ?? (inferredGoogleKey ? "google/gemini-2.5-flash-lite" : undefined);
  const modelApiKey =
    explicitModelApiKey ??
    (explicitModelName === undefined || explicitModelName.startsWith("google/")
      ? inferredGoogleKey
      : undefined);

  const stagehand = StagehandClientCreateConfigSchema.parse({
    logging: { level: "off" },
    ...(modelName
      ? {
          model: {
            modelName,
            ...(modelApiKey ? { apiKey: modelApiKey } : {}),
          },
        }
      : {}),
  });

  return {
    browser:
      browserType === "browserbase"
        ? {
            type: "browserbase",
            launchOptions: { apiKey: browserbaseApiKey },
          }
        : {
            type: "local",
            launchOptions: { headless: true },
          },
    stagehand,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
