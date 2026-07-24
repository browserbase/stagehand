/**
 * Initializes a Stagehand v4 client for use in evaluations,
 * mirroring initV3's environment resolution so matched v3/v4 runs are
 * comparable. Usage idioms follow v4-spike/packages/sdk-ts/examples/.
 *
 * Kept deliberately minimal: no agent support (agent tasks are not ported)
 * and no USE_API path (v3-only concept).
 */
import type {
  Stagehand,
  Page,
  StagehandClientInitParams,
} from "@browserbasehq/stagehand-v4-spike-sdk-ts";
import { getEnv } from "./env.js";
import type { EvalLogger } from "./logger.js";
import { loadV4Sdk } from "./v4SdkLoader.js";

export type InitV4Args = {
  logger: EvalLogger;
  modelName: string;
  /** Task-declared custom system prompt, forwarded to StagehandInitParams.systemPrompt. */
  systemPrompt?: string;
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

function resolveModelApiKey(
  modelName: string,
  processEnv: NodeJS.ProcessEnv,
): string {
  const provider = modelName.includes("/")
    ? modelName.split("/")[0]
    : undefined;
  const candidates = provider ? (PROVIDER_API_KEY_ENV[provider] ?? []) : [];
  for (const envVar of candidates) {
    const value = processEnv[envVar];
    if (value) return value;
  }
  throw new Error(
    `V4 init: no API key found for model "${modelName}". ` +
      `The v4 SDK requires an explicit model API key ` +
      `(checked: ${candidates.join(", ") || "no known provider prefix"}).`,
  );
}

function requireBrowserbaseApiKey(processEnv: NodeJS.ProcessEnv): string {
  const apiKey = processEnv.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "V4 init: BROWSERBASE_API_KEY is required for BROWSERBASE runs",
    );
  }
  return apiKey;
}

/**
 * Pure builder for the v4 client init params — exported for unit tests
 * (browserless coverage of key resolution, the anthropic CORS header, env
 * mapping, and systemPrompt forwarding).
 */
export function buildV4InitParams(input: {
  modelName: string;
  env: "LOCAL" | "BROWSERBASE";
  systemPrompt?: string;
  processEnv?: NodeJS.ProcessEnv;
}): StagehandClientInitParams {
  const processEnv = input.processEnv ?? process.env;

  // The model allow-list is enforced at runtime by the SDK's zod schema
  // (loud, descriptive error on an unsupported model), so the cast here is
  // runtime-checked.
  const model = {
    modelName: input.modelName,
    apiKey: resolveModelApiKey(input.modelName, processEnv),
    // The v4 extension calls model APIs from a browser origin; Anthropic
    // rejects browser CORS requests unless the client opts in with this
    // header (V4_API_LOGS #18). Passing it through model config keeps the
    // fix on the eval side — no v4-spike patch required.
    ...(input.modelName.startsWith("anthropic/")
      ? {
          headers: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
        }
      : {}),
  } as NonNullable<StagehandClientInitParams["model"]>;

  return {
    browser:
      input.env === "BROWSERBASE"
        ? { type: "browserbase" }
        : {
            type: "local",
            // Parity with initV3's local default (headless: false).
            headless: false,
          },
    ...(input.env === "BROWSERBASE"
      ? { apiKey: requireBrowserbaseApiKey(processEnv) }
      : {}),
    model,
    ...(input.systemPrompt !== undefined
      ? { systemPrompt: input.systemPrompt }
      : {}),
  };
}

export async function initV4({
  logger,
  modelName,
  systemPrompt,
  configOverrides,
}: InitV4Args): Promise<V4InitResult> {
  const env = configOverrides?.env ?? getEnv();

  // SDK module resolution honors STAGEHAND_V4_SDK_PATH (see v4SdkLoader.ts).
  const sdk = await loadV4Sdk();
  const { Stagehand } = sdk;

  // Bridge server log notifications into the eval logger so they land in
  // Braintrust rows instead of only the CLI console. Debug lines are
  // per-CDP-frame chatter (hundreds per action) — skip them.
  // onLog is new to the SDK and the client init schema is strict, so
  // feature-detect: older checkouts must not receive the unknown key.
  const sdkSupportsOnLog = Boolean(
    (
      sdk.StagehandClientInitParamsSchema as unknown as {
        shape?: Record<string, unknown>;
      }
    )?.shape?.onLog,
  );
  const onLog: NonNullable<StagehandClientInitParams["onLog"]> = (line) => {
    if (line.level === "debug") return;
    logger.log({
      message: line.message,
      level: line.level === "error" ? 0 : line.level === "warn" ? 1 : 2,
      ...(line.data !== undefined
        ? {
            auxiliary: {
              data: { value: JSON.stringify(line.data), type: "object" },
            },
          }
        : {}),
    });
  };

  const stagehand = new Stagehand({
    ...buildV4InitParams({ modelName, env, systemPrompt }),
    ...(sdkSupportsOnLog ? { onLog } : {}),
  });

  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    await stagehand.close();
    throw new Error("V4 init: Stagehand initialized without an active page");
  }

  // The SDK exposes only the Browserbase session ID; there is no debugger
  // URL accessor (see V4_API_LOGS.md).
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
