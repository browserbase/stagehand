import {
  Stagehand,
  browserbase,
  localBrowser,
  type Page,
  type StagehandClientLoggingConfig,
  type StagehandCreateOptions,
} from "@browserbasehq/stagehand";
import type { EvalLogger } from "./logger.js";
import { launchRunnerProvidedBrowserbaseChrome } from "./core/targets/browserbase.js";
import { onceAsync, registerActiveRunCleanup } from "./framework/activeRunCleanup.js";
import { EVAL_SYSTEM_PROMPT } from "./framework/evalSystemPrompt.js";
import { resolveKey } from "./tui/welcomeStatus.js";

export type InitStagehandArgs = {
  logger: EvalLogger;
  modelName: string;
  environment: "LOCAL" | "BROWSERBASE";
};

export type StagehandInitResult = {
  stagehand: Stagehand;
  page: Page;
  sessionUrl: string;
  debugUrl: string;
  cleanup: () => Promise<void>;
};

const PROVIDER_API_KEY_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
};

type StagehandLogEvent = Parameters<NonNullable<StagehandClientLoggingConfig["onLog"]>>[0];

function createStagehandOnLog(logger: EvalLogger): (event: StagehandLogEvent) => void {
  return (event) => {
    // Debug lines are dropped rather than bridged: bridging them produces
    // ~18MB Braintrust payloads that the API rejects.
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

export async function initStagehand({
  logger,
  modelName,
  environment,
}: InitStagehandArgs): Promise<StagehandInitResult> {
  const provider = modelName.includes("/") ? modelName.split("/")[0].toLowerCase() : undefined;
  const keyEnvVars = provider ? (PROVIDER_API_KEY_ENV[provider] ?? []) : [];
  const apiKey = keyEnvVars.map((name) => resolveKey(name).value).find(Boolean);
  if (!apiKey) {
    throw new Error(
      `Stagehand init: no API key found for model "${modelName}". ` +
        `Stagehand requires an explicit model API key ` +
        `(checked: ${keyEnvVars.join(", ") || "no known provider prefix"}).`,
    );
  }

  let browser;
  let sessionUrl = "";
  let debugUrl = "";
  let endSession: () => Promise<void> = async () => {};
  if (environment === "BROWSERBASE") {
    const browserbaseApiKey =
      resolveKey("BROWSERBASE_API_KEY").value || resolveKey("BB_API_KEY").value;
    if (!browserbaseApiKey) {
      throw new Error(
        "Stagehand init: BROWSERBASE_API_KEY or BB_API_KEY is required for BROWSERBASE runs",
      );
    }
    const session = await launchRunnerProvidedBrowserbaseChrome();
    sessionUrl = session.sessionUrl;
    debugUrl = session.debugUrl ?? "";
    endSession = session.cleanup;
    try {
      browser = await browserbase.connect({
        apiKey: browserbaseApiKey,
        sessionId: session.sessionId,
      });
    } catch (error) {
      await endSession().catch(() => {});
      throw error;
    }
  } else {
    browser = await localBrowser.launch({ headless: false });
  }

  let stagehand: Stagehand | undefined;
  const cleanupOwnedResources = onceAsync(async () => {
    await stagehand?.close().catch(() => {});
    await browser.close().catch(() => {});
    await endSession().catch(() => {});
  });
  const unregisterCleanup = registerActiveRunCleanup(cleanupOwnedResources);
  const cleanup = async (): Promise<void> => {
    await cleanupOwnedResources();
    unregisterCleanup();
  };

  try {
    stagehand = await Stagehand.create({
      browser,
      systemPrompt: EVAL_SYSTEM_PROMPT,
      selfHeal: true,
      model: { modelName, apiKey } as NonNullable<StagehandCreateOptions["model"]>,
      logging: { onLog: createStagehandOnLog(logger) },
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  let page: Page | null;
  try {
    page = await stagehand.browser.context.activePage();
    if (!page) {
      throw new Error("Stagehand init: Stagehand initialized without an active page");
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    stagehand,
    page,
    sessionUrl,
    debugUrl,
    cleanup,
  };
}
