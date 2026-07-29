/**
 * Initializes a Stagehand v4 client for use in evaluations,
 * mirroring initV3's environment resolution so matched v3/v4 runs are
 * comparable. Usage idioms follow v4-spike/packages/sdk-ts/examples/.
 *
 * Kept deliberately minimal: no agent support (agent tasks are not ported)
 * and no USE_API path (v3-only concept).
 */
import {
  Stagehand,
  StagehandClientInitParamsSchema,
  type Page,
  type StagehandClientInitParams,
} from "@browserbasehq/stagehand";
import type { LogLine } from "stagehand-v3";
import { getEnv } from "./env.js";
import type { EvalLogger } from "./logger.js";

export type InitV4Args = {
  logger: EvalLogger;
  modelName: string;
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

function resolveModelApiKey(modelName: string): string {
  const provider = modelName.includes("/") ? modelName.split("/")[0] : undefined;
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
    throw new Error("V4 init: BROWSERBASE_API_KEY is required for BROWSERBASE runs");
  }
  return apiKey;
}

/** Shape of a v4 SDK log event (protocol StagehandLogSchema). */
export type V4SdkLogEvent = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Adapt v4 SDK log events into the EvalLogger's v3 LogLine shape so SDK
 * diagnostics land in per-task eval logs instead of only on the console.
 * Level mapping: error→0, warn→1, everything else→2; "debug" events are
 * dropped (they never reach eval logs on the v3 path either). Event data
 * rides along as auxiliary JSON so parseLogLine can structure it.
 */
export function createV4OnLog(logger: EvalLogger): (event: V4SdkLogEvent) => void {
  return (event) => {
    if (!event || typeof event.message !== "string") return;
    if (event.level === "debug") return;
    const level: LogLine["level"] = event.level === "error" ? 0 : event.level === "warn" ? 1 : 2;
    let auxiliary: LogLine["auxiliary"];
    if (event.data && Object.keys(event.data).length > 0) {
      try {
        auxiliary = {
          data: { value: JSON.stringify(event.data), type: "object" },
        };
      } catch {
        auxiliary = undefined; // non-serializable data: keep the message anyway
      }
    }
    logger.log({
      category: "v4-sdk",
      message: event.message,
      level,
      ...(auxiliary ? { auxiliary } : {}),
    });
  };
}

/**
 * Feature-detect how (and whether) the loaded v4 SDK accepts a log callback,
 * and return the matching init-params fragment. The SDK's client init schema
 * is strict, so blindly passing an unsupported key would throw — instead we
 * inspect the exported zod schema's shape:
 *   - `logging` key  → nested logging config ({ logging: { onLog } })
 *   - `onLog` key    → older top-level callback ({ onLog })
 *   - anything else  → no logging wired (SDK diagnostics stay on the console)
 */
export function buildV4LoggingParams(sdk: unknown, logger: EvalLogger): Record<string, unknown> {
  let shape: Record<string, unknown> | undefined;
  try {
    const schema = (sdk as { StagehandClientInitParamsSchema?: { shape?: unknown } } | undefined)
      ?.StagehandClientInitParamsSchema;
    const candidate = schema?.shape;
    if (candidate && typeof candidate === "object") {
      shape = candidate as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  if (!shape) return {};

  const onLog = createV4OnLog(logger);
  if ("logging" in shape) return { logging: { onLog } };
  if ("onLog" in shape) return { onLog };
  return {};
}

/**
 * Pure builder for the v4 Stagehand constructor params. Kept separate from
 * initV4 so parity-critical fields (selfHeal, headless, logging wiring) are
 * unit-testable without a live SDK.
 */
export function buildV4InitParams(input: {
  env: "LOCAL" | "BROWSERBASE";
  model: NonNullable<StagehandClientInitParams["model"]>;
  browserbaseApiKey?: string;
  loggingParams?: Record<string, unknown>;
  systemPrompt?: string;
}): StagehandClientInitParams {
  return {
    browser:
      input.env === "BROWSERBASE"
        ? { type: "browserbase" }
        : {
            type: "local",
            // Parity with initV3's local default (headless: false).
            headless: false,
          },
    ...(input.browserbaseApiKey ? { apiKey: input.browserbaseApiKey } : {}),
    model: input.model,
    // Parity with initV3 (selfHeal: true): matched v3/v4 benchmark runs must
    // use the same self-healing behavior to be comparable.
    selfHeal: true,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.loggingParams ?? {}),
  } as StagehandClientInitParams;
}

export async function initV4({
  logger,
  modelName,
  systemPrompt,
  configOverrides,
}: InitV4Args): Promise<V4InitResult> {
  const env = configOverrides?.env ?? getEnv();

  // The model allow-list is enforced at runtime by the SDK's zod schema
  // (loud, descriptive error on an unsupported model), so the cast here is
  // runtime-checked.
  const model = {
    modelName,
    apiKey: resolveModelApiKey(modelName),
  } as NonNullable<StagehandClientInitParams["model"]>;

  const stagehand = new Stagehand(
    buildV4InitParams({
      env,
      model,
      browserbaseApiKey: env === "BROWSERBASE" ? requireBrowserbaseApiKey() : undefined,
      loggingParams: buildV4LoggingParams({ StagehandClientInitParamsSchema }, logger),
      systemPrompt,
    }),
  );

  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    await stagehand.close();
    throw new Error("V4 init: Stagehand initialized without an active page");
  }

  // The SDK exposes only the Browserbase session ID; there is no debugger
  // URL accessor. SDK diagnostics are forwarded to the EvalLogger via the
  // logging callback wired in buildV4LoggingParams.
  const sessionId = stagehand.browser?.browserbaseSessionId;
  const sessionUrl = sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined;

  return {
    stagehand,
    page,
    logger,
    debugUrl: undefined,
    sessionUrl,
    modelName,
  };
}
