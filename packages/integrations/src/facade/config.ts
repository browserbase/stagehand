import {
  StagehandClientCreateConfigSchema,
  type BrowserbaseLaunchOptions,
  type LocalBrowserLaunchOptions,
  type StagehandClientCreateConfig,
} from "@browserbasehq/stagehand";

export class StagehandFacadeConfigError extends Error {
  override readonly name = "StagehandFacadeConfigError";
}

export type StagehandFacadeConfig = {
  browser:
    | { type: "local"; launchOptions: LocalBrowserLaunchOptions }
    | { type: "browserbase"; launchOptions: BrowserbaseLaunchOptions };
  stagehand: StagehandClientCreateConfig;
};

export function stagehandFacadeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StagehandFacadeConfig {
  const browserbaseApiKey = nonEmpty(env.BROWSERBASE_API_KEY);
  const browserbaseProjectId = nonEmpty(env.BROWSERBASE_PROJECT_ID);
  const requestedBrowser = nonEmpty(env.STAGEHAND_BROWSER);
  if (requestedBrowser && requestedBrowser !== "local" && requestedBrowser !== "browserbase") {
    throw new StagehandFacadeConfigError(
      'STAGEHAND_BROWSER must be either "local" or "browserbase".',
    );
  }

  const browserType = requestedBrowser ?? (browserbaseApiKey ? "browserbase" : "local");
  if (browserType === "browserbase" && !browserbaseApiKey) {
    throw new StagehandFacadeConfigError(
      'BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER="browserbase".',
    );
  }

  const explicitModelName = nonEmpty(env.STAGEHAND_MODEL_NAME);
  const explicitModelApiKey = nonEmpty(env.STAGEHAND_MODEL_API_KEY);
  if (explicitModelApiKey && !explicitModelName) {
    throw new StagehandFacadeConfigError(
      "STAGEHAND_MODEL_NAME is required when STAGEHAND_MODEL_API_KEY is set.",
    );
  }

  const inferredGoogleKey = providerApiKey("google", env);
  const modelName =
    explicitModelName ?? (inferredGoogleKey ? "google/gemini-3.6-flash" : undefined);
  const modelProvider = modelName ? providerName(modelName) : undefined;
  const modelApiKey = explicitModelApiKey ?? providerApiKey(modelProvider, env);
  const parsed = StagehandClientCreateConfigSchema.safeParse({
    logging: { level: "off" },
    ...(modelName
      ? {
          model: {
            modelName,
            ...(modelApiKey ? { apiKey: modelApiKey } : {}),
            ...(modelProvider === "anthropic"
              ? { headers: { "anthropic-dangerous-direct-browser-access": "true" } }
              : {}),
          },
        }
      : {}),
  });
  if (!parsed.success) {
    throw new StagehandFacadeConfigError(
      `Unsupported STAGEHAND_MODEL_NAME "${modelName}": ${parsed.error.issues[0]?.message ?? "invalid model configuration"}`,
    );
  }
  const stagehand = parsed.data;

  return {
    browser:
      browserType === "browserbase"
        ? {
            type: "browserbase",
            launchOptions: {
              apiKey: browserbaseApiKey!,
              ...(browserbaseProjectId ? { projectId: browserbaseProjectId } : {}),
            },
          }
        : { type: "local", launchOptions: { headless: true } },
    stagehand,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function providerName(modelName: string): string {
  return modelName.split("/", 1)[0] ?? "";
}

function providerApiKey(provider: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  switch (provider) {
    case "google":
      return (
        nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY) ??
        nonEmpty(env.GEMINI_API_KEY) ??
        nonEmpty(env.GOOGLE_API_KEY)
      );
    case "openai":
      return nonEmpty(env.OPENAI_API_KEY);
    case "anthropic":
      return nonEmpty(env.ANTHROPIC_API_KEY);
    case "groq":
      return nonEmpty(env.GROQ_API_KEY);
    case "cerebras":
      return nonEmpty(env.CEREBRAS_API_KEY);
    default:
      return undefined;
  }
}
