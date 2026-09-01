import {
  StagehandClientCreateConfigSchema,
  type BrowserbaseLaunchOptions,
  type LocalBrowserLaunchOptions,
  type StagehandClientCreateConfig,
} from "@browserbasehq/stagehand";

export class StagehandFacadeConfigError extends Error {
  override readonly name = "StagehandFacadeConfigError";
}

/** Browserbase's project default is 15 minutes, shorter than most agent tasks. */
export const DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 3600;
/** Browserbase rejects longer sessions (6 hours). */
export const MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS = 21_600;

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
  const sessionTimeoutSeconds = browserbaseSessionTimeoutSeconds(
    env.STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
  );
  const proxies = booleanEnv(env.STAGEHAND_BROWSERBASE_PROXIES, "STAGEHAND_BROWSERBASE_PROXIES");
  const verified = booleanEnv(env.STAGEHAND_BROWSERBASE_VERIFIED, "STAGEHAND_BROWSERBASE_VERIFIED");

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
              timeout: sessionTimeoutSeconds,
              // The facade owns the session for exactly one task; nothing reconnects later.
              keepAlive: false,
              // Bot-wall parity with Stagehand's native agent path, which runs
              // proxied + verified sessions; unproxied facade sessions were
              // blocked (Akamai/PerimeterX) on sites the native path reached.
              ...(proxies !== undefined ? { proxies } : {}),
              ...(verified !== undefined ? { browserSettings: { verified } } : {}),
            },
          }
        : { type: "local", launchOptions: { headless: false } },
    stagehand,
  };
}

function browserbaseSessionTimeoutSeconds(raw: string | undefined): number {
  const value = nonEmpty(raw);
  if (value === undefined) return DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS;
  const parsed = Number(value);
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS
  ) {
    throw new StagehandFacadeConfigError(
      `STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS must be a positive integer of at most ${MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS} seconds (got "${value}").`,
    );
  }
  return parsed;
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

function booleanEnv(value: string | undefined, name: string): boolean | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "on") return true;
  if (trimmed === "0" || trimmed === "false" || trimmed === "no" || trimmed === "off") return false;
  throw new StagehandFacadeConfigError(`${name} must be a boolean (got "${value}").`);
}
