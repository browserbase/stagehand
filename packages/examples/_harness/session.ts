// Every lane of a task gets the same kind of Browserbase session, so no lane
// benefits from different proxies, viewport, or captcha handling. Proxies are
// opt-in per task: Stagehand calls the model from inside the browser, and the
// proxy drops requests that wait on a response for more than ~15 seconds.
export function sessionSettings(task: { proxies?: boolean }) {
  return {
    browserSettings: {
      recordSession: true,
      viewport: { width: 1280, height: 720 },
    },
    proxies: task.proxies ?? false,
  };
}

// Both sides always run the same model. Override with SHOWCASE_MODEL.
export const MODEL = (process.env.SHOWCASE_MODEL ?? "anthropic/claude-sonnet-5") as
  | "anthropic/claude-sonnet-5"
  | "openai/gpt-5.4-mini";

export const PROVIDER = MODEL.split("/")[0] as "anthropic" | "openai";
export const MODEL_ID = MODEL.slice(PROVIDER.length + 1);

const MODEL_KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" } as const;

export function requireEnv(): { BROWSERBASE_API_KEY: string; MODEL_API_KEY: string } {
  const { BROWSERBASE_API_KEY } = process.env;
  const MODEL_API_KEY = process.env[MODEL_KEY_ENV[PROVIDER]];
  if (!BROWSERBASE_API_KEY || !MODEL_API_KEY) {
    throw new Error(
      `Set BROWSERBASE_API_KEY and ${MODEL_KEY_ENV[PROVIDER]} in packages/examples/.env`,
    );
  }
  return { BROWSERBASE_API_KEY, MODEL_API_KEY };
}

// Stagehand calls the model from inside the browser extension, so Anthropic
// needs its browser-access header, as the facade config also sets.
export function stagehandModel(apiKey: string) {
  return {
    modelName: MODEL,
    apiKey,
    ...(PROVIDER === "anthropic"
      ? { headers: { "anthropic-dangerous-direct-browser-access": "true" } }
      : {}),
  };
}
