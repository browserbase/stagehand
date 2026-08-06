import { StagehandClientCreateConfigSchema } from "@browserbasehq/stagehand";
import type { StagehandCodeConfig } from "./types.js";

const ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER = "anthropic-dangerous-direct-browser-access";

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
  const browserbaseProjectId = nonEmpty(env.BROWSERBASE_PROJECT_ID);
  const browserType = requestedBrowser ?? (browserbaseApiKey ? "browserbase" : "local");
  if (browserType === "browserbase" && !browserbaseApiKey) {
    throw new Error('BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER="browserbase".');
  }

  const explicitModelName = nonEmpty(env.STAGEHAND_MODEL_NAME);
  const explicitModelApiKey = nonEmpty(env.STAGEHAND_MODEL_API_KEY);
  if (!explicitModelName && explicitModelApiKey) {
    throw new Error("STAGEHAND_MODEL_NAME is required when STAGEHAND_MODEL_API_KEY is set.");
  }

  const inferredGoogleKey = providerApiKey("google", env);
  const modelName =
    explicitModelName ?? (inferredGoogleKey ? "google/gemini-2.5-flash-lite" : undefined);
  const modelProvider = modelName ? providerName(modelName) : undefined;
  const modelApiKey = explicitModelApiKey ?? providerApiKey(modelProvider, env);

  const stagehand = StagehandClientCreateConfigSchema.parse({
    logging: { level: "off" },
    ...(modelName
      ? {
          model: {
            modelName,
            ...(modelApiKey ? { apiKey: modelApiKey } : {}),
            ...(modelProvider === "anthropic"
              ? { headers: { [ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER]: "true" } }
              : {}),
          },
        }
      : {}),
  });

  return {
    browser:
      browserType === "browserbase"
        ? {
            type: "browserbase",
            launchOptions: {
              apiKey: browserbaseApiKey,
              ...(browserbaseProjectId ? { projectId: browserbaseProjectId } : {}),
            },
          }
        : {
            type: "local",
            launchOptions: { headless: true },
          },
    stagehand,
  };
}

function providerName(modelName: string): string | undefined {
  const separator = modelName.indexOf("/");
  return separator === -1 ? undefined : modelName.slice(0, separator).toLowerCase();
}

function providerApiKey(provider: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  switch (provider) {
    case "openai":
      return nonEmpty(env.OPENAI_API_KEY);
    case "anthropic":
      return nonEmpty(env.ANTHROPIC_API_KEY);
    case "google":
      return (
        nonEmpty(env.GEMINI_API_KEY) ??
        nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY) ??
        nonEmpty(env.GOOGLE_API_KEY)
      );
    case "groq":
      return nonEmpty(env.GROQ_API_KEY);
    case "cerebras":
      return nonEmpty(env.CEREBRAS_API_KEY);
    default:
      return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
