/** Initializes the Stagehand client used by benchmark tasks. */
import {
  Stagehand,
  StagehandClientInitParamsSchema,
  type Page,
  type StagehandClientInitParams,
} from "@browserbasehq/stagehand";
import { getEnv } from "./env.js";
import type { EvalLogger } from "./logger.js";
import { resolveKey } from "./tui/welcomeStatus.js";

export type InitStagehandArgs = {
  logger: EvalLogger;
  modelName: string;
  systemPrompt?: string;
  configOverrides?: {
    env?: "LOCAL" | "BROWSERBASE";
  };
};

export type StagehandInitResult = {
  stagehand: Stagehand;
  page: Page;
  logger: EvalLogger;
  debugUrl?: string;
  sessionUrl?: string;
  modelName: string;
};

/**
 * Env vars checked per provider prefix, in order. Stagehand routes LLM
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

type KeyLookup = (name: string) => string;

const resolvePackageAwareKey: KeyLookup = (name) => resolveKey(name).value;

export function resolveModelApiKey(
  modelName: string,
  lookup: KeyLookup = resolvePackageAwareKey,
): string {
  const provider = modelName.includes("/") ? modelName.split("/")[0].toLowerCase() : undefined;
  const candidates = provider ? (PROVIDER_API_KEY_ENV[provider] ?? []) : [];
  for (const envVar of candidates) {
    const value = lookup(envVar);
    if (value) return value;
  }
  throw new Error(
    `Stagehand init: no API key found for model "${modelName}". ` +
      `Stagehand requires an explicit model API key ` +
      `(checked: ${candidates.join(", ") || "no known provider prefix"}).`,
  );
}

export function requireBrowserbaseApiKey(lookup: KeyLookup = resolvePackageAwareKey): string {
  const apiKey = lookup("BROWSERBASE_API_KEY") || lookup("BB_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Stagehand init: BROWSERBASE_API_KEY or BB_API_KEY is required for BROWSERBASE runs",
    );
  }
  return apiKey;
}

/** Shape of a Stagehand log event. */
type StagehandLogEvent = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Forward Stagehand log events into the EvalLogger so diagnostics land in
 * per-task eval logs instead of only on the console.
 * Level mapping: error→0, warn→1, everything else→2; "debug" events are
 * dropped. Event data rides along as auxiliary JSON so parseLogLine can
 * structure it.
 */
export function createStagehandOnLog(logger: EvalLogger): (event: StagehandLogEvent) => void {
  return (event) => {
    if (!event || typeof event.message !== "string") return;
    if (event.level === "debug") return;
    const level = event.level === "error" ? 0 : event.level === "warn" ? 1 : 2;
    let auxiliary: Record<string, { value: string; type: "object" }> | undefined;
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
      category: "stagehand-sdk",
      message: event.message,
      level,
      ...(auxiliary ? { auxiliary } : {}),
    });
  };
}

/**
 * Feature-detect how the loaded Stagehand client accepts a log callback,
 * and return the matching init-params fragment. The SDK's client init schema
 * is strict, so blindly passing an unsupported key would throw — instead we
 * inspect the exported zod schema's shape:
 *   - `logging` key  → nested logging config ({ logging: { onLog } })
 *   - `onLog` key    → older top-level callback ({ onLog })
 *   - anything else  → no logging wired (SDK diagnostics stay on the console)
 */
export function buildStagehandLoggingParams(
  clientExports: unknown,
  logger: EvalLogger,
): Record<string, unknown> {
  let shape: Record<string, unknown> | undefined;
  try {
    const schema = (
      clientExports as { StagehandClientInitParamsSchema?: { shape?: unknown } } | undefined
    )?.StagehandClientInitParamsSchema;
    const candidate = schema?.shape;
    if (candidate && typeof candidate === "object") {
      shape = candidate as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  if (!shape) return {};

  const onLog = createStagehandOnLog(logger);
  if ("logging" in shape) return { logging: { onLog } };
  if ("onLog" in shape) return { onLog };
  return {};
}

/**
 * Pure builder for the Stagehand constructor params so environment defaults
 * and logging wiring are unit-testable without a live browser.
 */
export function buildStagehandInitParams(input: {
  env: "LOCAL" | "BROWSERBASE";
  model: NonNullable<StagehandClientInitParams["model"]>;
  browserbaseApiKey?: string;
  systemPrompt?: string;
  loggingParams?: Record<string, unknown>;
}): StagehandClientInitParams {
  return {
    browser:
      input.env === "BROWSERBASE"
        ? { type: "browserbase" }
        : {
            type: "local",
            headless: false,
          },
    ...(input.browserbaseApiKey ? { apiKey: input.browserbaseApiKey } : {}),
    model: input.model,
    selfHeal: true,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.loggingParams ?? {}),
  } as StagehandClientInitParams;
}

export async function initStagehand({
  logger,
  modelName,
  systemPrompt,
  configOverrides,
}: InitStagehandArgs): Promise<StagehandInitResult> {
  const env = configOverrides?.env ?? getEnv();

  // The model allow-list is enforced at runtime by the SDK's zod schema
  // (loud, descriptive error on an unsupported model), so the cast here is
  // runtime-checked.
  const model = {
    modelName,
    apiKey: resolveModelApiKey(modelName),
  } as NonNullable<StagehandClientInitParams["model"]>;

  const stagehand = new Stagehand(
    buildStagehandInitParams({
      env,
      model,
      browserbaseApiKey: env === "BROWSERBASE" ? requireBrowserbaseApiKey() : undefined,
      systemPrompt,
      loggingParams: buildStagehandLoggingParams({ StagehandClientInitParamsSchema }, logger),
    }),
  );

  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    await stagehand.close();
    throw new Error("Stagehand init: Stagehand initialized without an active page");
  }

  // The SDK exposes only the Browserbase session ID; there is no debugger
  // URL accessor. SDK diagnostics are forwarded to the EvalLogger via the
  // logging callback wired in buildStagehandLoggingParams.
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
