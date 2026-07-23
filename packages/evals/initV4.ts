/**
 * Initializes a Stagehand v4 client for use in evaluations,
 * mirroring initV3's environment resolution so matched v3/v4 runs are
 * comparable. Usage idioms follow v4-spike/packages/sdk-ts/examples/.
 *
 * Kept deliberately minimal: no agent support (agent tasks are not ported)
 * and no USE_API path (v3-only concept).
 */
import type {
  Page,
  Stagehand,
  StagehandClientInitParams,
} from "@browserbasehq/stagehand-v4-spike-sdk-ts";
import { getEnv } from "./env.js";
import type { EvalLogger } from "./logger.js";

export type InitV4Args = {
  logger: EvalLogger;
  modelName: string;
  configOverrides?: {
    env?: "LOCAL" | "BROWSERBASE";
  };
};

export type V4InitResult = {
  stagehand: Stagehand;
  page: Page;
  logger: EvalLogger;
  debugUrl?: string;
  sessionUrl?: string;
  modelName: string;
};

/**
 * Env vars checked per provider prefix, in order. The v4 SDK routes LLM
 * calls through the in-browser extension, so the key must be passed
 * explicitly in init params — ambient process env is not visible to it.
 */
const PROVIDER_API_KEY_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
};

function resolveModelApiKey(modelName: string): string {
  const provider = modelName.includes("/")
    ? modelName.split("/")[0]
    : undefined;
  const candidates = provider ? (PROVIDER_API_KEY_ENV[provider] ?? []) : [];
  for (const envVar of candidates) {
    const value = process.env[envVar];
    if (value) return value;
  }
  throw new Error(
    `V4 init: no API key found for model "${modelName}". ` +
      `The v4 SDK requires an explicit model API key ` +
      `(checked: ${candidates.join(", ") || "no known provider prefix"}).`,
  );
}

function requireBrowserbaseApiKey(): string {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "V4 init: BROWSERBASE_API_KEY is required for BROWSERBASE runs",
    );
  }
  return apiKey;
}

export async function initV4({
  logger,
  modelName,
  configOverrides,
}: InitV4Args): Promise<V4InitResult> {
  const env = configOverrides?.env ?? getEnv();

  // Import the SDK lazily: merely loading the tool registry / CLI (e.g. for a
  // non-v4 command, or a unit test) must not require the unpublished v4-spike
  // package to be resolvable at module load. Only an actual v4 init pulls it in.
  const { Stagehand } = await import(
    "@browserbasehq/stagehand-v4-spike-sdk-ts"
  );

  // The model allow-list is enforced at runtime by the SDK's zod schema
  // (loud, descriptive error on an unsupported model), so the cast here is
  // runtime-checked.
  const model = {
    modelName,
    apiKey: resolveModelApiKey(modelName),
  } as NonNullable<StagehandClientInitParams["model"]>;

  const stagehand = new Stagehand({
    browser:
      env === "BROWSERBASE"
        ? { type: "browserbase" }
        : {
            type: "local",
            // Parity with initV3's local default (headless: false).
            headless: false,
          },
    ...(env === "BROWSERBASE" ? { apiKey: requireBrowserbaseApiKey() } : {}),
    model,
  });

  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    await stagehand.close();
    throw new Error("V4 init: Stagehand initialized without an active page");
  }

  // The SDK exposes only the Browserbase session ID; there is no debugger
  // URL accessor (see V4_API_LOGS.md). The v4 SDK also accepts no logger —
  // its notifications go straight to the console.
  const sessionId = stagehand.browser?.browserbaseSessionId;
  const sessionUrl = sessionId
    ? `https://www.browserbase.com/sessions/${sessionId}`
    : undefined;

  return {
    stagehand,
    page,
    logger,
    debugUrl: undefined,
    sessionUrl,
    modelName,
  };
}
