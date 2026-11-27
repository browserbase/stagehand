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

  const useDecisions = process.env.EVAL_DECISIONS === "1";
  let experimentalDecisions: StagehandCreateOptions["experimentalDecisions"];
  if (!useDecisions && process.env.EVAL_DECISIONS_INSTRUMENT === "1") {
    experimentalDecisions = { apiKey: "instrument-only" };
  }
  const decisionsObserve = useDecisions && process.env.EVAL_DECISIONS_OBSERVE === "1";
  const decisionsExtract =
    useDecisions &&
    (process.env.EVAL_DECISIONS_EXTRACT === "pick" ||
      process.env.EVAL_DECISIONS_EXTRACT === "judge");
  if (useDecisions) {
    const keyNames = {
      typesafe: "TYPESAFE_API_KEY",
      cloudflare: "CLOUDFLARE_API_TOKEN",
      perplexity: "PERPLEXITY_API_KEY",
      openai: "OPENAI_API_KEY",
    } as const;
    const requested = process.env.EVAL_DECISIONS_PROVIDER ?? "typesafe";
    if (!(requested in keyNames)) {
      throw new Error(`Stagehand init: unknown EVAL_DECISIONS_PROVIDER "${requested}"`);
    }
    const provider = requested as keyof typeof keyNames;
    const keyName = keyNames[provider];
    const decisionsApiKey = resolveKey(keyName).value;
    if (!decisionsApiKey) {
      throw new Error(
        `Stagehand init: EVAL_DECISIONS=1 with provider "${provider}" requires ${keyName}`,
      );
    }
    if (provider === "cloudflare" && !process.env.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error('Stagehand init: provider "cloudflare" requires CLOUDFLARE_ACCOUNT_ID');
    }
    const actConfidence = Number(process.env.EVAL_DECISIONS_CONFIDENCE);
    experimentalDecisions = {
      ...(provider === "typesafe" ? {} : { provider }),
      apiKey: decisionsApiKey,
      ...(provider === "cloudflare" ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      ...(process.env.EVAL_DECISIONS_MODEL ? { model: process.env.EVAL_DECISIONS_MODEL } : {}),
      ...(Number.isFinite(actConfidence) && process.env.EVAL_DECISIONS_CONFIDENCE
        ? { actConfidence }
        : {}),
      ...(process.env.EVAL_DECISIONS_VERIFY === "0"
        ? { verify: "off" }
        : process.env.EVAL_DECISIONS_VERIFY === "full"
          ? { verify: "full" }
          : {}),
      ...(process.env.EVAL_DECISIONS_LLM_FALLBACK === "0" ? { llmFallback: false } : {}),
      ...(process.env.EVAL_DECISIONS_ARG_LLM === "0" ? { argumentLlm: false } : {}),
      ...(process.env.EVAL_DECISIONS_TOOLS === "1" ? { tools: true } : {}),
      ...(process.env.EVAL_DECISIONS_READINESS === "1" ? { targetReadiness: true } : {}),
      ...(decisionsExtract
        ? { extract: process.env.EVAL_DECISIONS_EXTRACT as "pick" | "judge" }
        : {}),
      ...(process.env.EVAL_DECISIONS_CACHE_CHECK === "1" ? { cacheCheck: true } : {}),
      ...(process.env.EVAL_DECISIONS_RETRY === "1" ? { retryNoEffect: true } : {}),
      ...(process.env.EVAL_DECISIONS_FOCUS === "1" ? { focusFallback: true } : {}),
    };
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
      ...(experimentalDecisions ? { experimentalDecisions } : {}),
    });
    if (useDecisions) {
      const decisions = stagehand.experimentalDecisions;
      stagehand.act = decisions.act.bind(decisions);
      if (decisionsObserve) stagehand.observe = decisions.observe.bind(decisions);
      if (decisionsExtract) stagehand.extract = decisions.extract.bind(decisions);
    }
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
