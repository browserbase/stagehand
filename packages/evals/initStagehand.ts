/** Initializes the Stagehand client used by benchmark tasks. */
import {
  Stagehand,
  type Page,
  type StagehandClientInitParams,
  type StagehandClientLoggingConfig,
} from "@browserbasehq/stagehand";
import type { EvalLogger } from "./logger.js";
import { resolveKey } from "./tui/welcomeStatus.js";

export type InitStagehandArgs = {
  logger: EvalLogger;
  modelName: string;
  systemPrompt?: string;
  environment: "LOCAL" | "BROWSERBASE";
};

export type StagehandInitResult = {
  stagehand: Stagehand;
  page: Page;
  sessionUrl?: string;
};

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

type StagehandLogEvent = Parameters<NonNullable<StagehandClientLoggingConfig["onLog"]>>[0];

function createStagehandOnLog(logger: EvalLogger): (event: StagehandLogEvent) => void {
  return (event) => {
    if (event.level === "debug") return;

    const level = event.level === "error" ? 0 : event.level === "warn" ? 1 : 2;
    const auxiliary =
      Object.keys(event.data).length > 0
        ? {
            data: { value: JSON.stringify(event.data), type: "object" as const },
          }
        : undefined;

    logger.log({
      category: "stagehand-sdk",
      message: event.message,
      level,
      ...(auxiliary ? { auxiliary } : {}),
    });
  };
}

export function buildStagehandInitParams(input: {
  env: "LOCAL" | "BROWSERBASE";
  model: NonNullable<StagehandClientInitParams["model"]>;
  browserbaseApiKey?: string;
  systemPrompt?: string;
  logger: EvalLogger;
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
    logging: { onLog: createStagehandOnLog(input.logger) },
  };
}

export async function initStagehand({
  logger,
  modelName,
  systemPrompt,
  environment,
}: InitStagehandArgs): Promise<StagehandInitResult> {
  const model = {
    modelName,
    apiKey: resolveModelApiKey(modelName),
  } as NonNullable<StagehandClientInitParams["model"]>;

  const stagehand = new Stagehand(
    buildStagehandInitParams({
      env: environment,
      model,
      browserbaseApiKey: environment === "BROWSERBASE" ? requireBrowserbaseApiKey() : undefined,
      systemPrompt,
      logger,
    }),
  );

  await stagehand.init();

  const page = await stagehand.context.activePage();
  if (!page) {
    await stagehand.close();
    throw new Error("Stagehand init: Stagehand initialized without an active page");
  }

  const sessionId = stagehand.browser?.browserbaseSessionId;
  const sessionUrl = sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined;

  return {
    stagehand,
    page,
    sessionUrl,
  };
}
