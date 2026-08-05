/** Initializes the Stagehand client used by benchmark tasks. */
import {
  Stagehand,
  browserbase,
  localBrowser,
  type Page,
  type StagehandClientLoggingConfig,
  type StagehandCreateOptions,
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
  systemPrompt,
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

  // `browser` is a factory-built handle rather than a config object:
  // StagehandBrowser is branded (#2517), so an object literal cannot satisfy it.
  let browser;
  if (environment === "BROWSERBASE") {
    // Checked here rather than left to zod: BrowserbaseLaunchOptions requires a
    // non-empty key, so an absent one would surface as a parse error instead.
    const browserbaseApiKey =
      resolveKey("BROWSERBASE_API_KEY").value || resolveKey("BB_API_KEY").value;
    if (!browserbaseApiKey) {
      throw new Error(
        "Stagehand init: BROWSERBASE_API_KEY or BB_API_KEY is required for BROWSERBASE runs",
      );
    }
    // Passed explicitly, matching initV3 and core/targets/browserbase: the
    // Browserbase SDK does not read BROWSERBASE_PROJECT_ID from the
    // environment, and omitting it lands sessions in the key's default
    // project — the wrong one for keys that own several.
    const projectId =
      resolveKey("BROWSERBASE_PROJECT_ID").value || resolveKey("BB_PROJECT_ID").value;
    browser = await browserbase.launch({
      apiKey: browserbaseApiKey,
      ...(projectId ? { projectId } : {}),
    });
  } else {
    browser = await localBrowser.launch({ headless: false });
  }

  // `Stagehand.create` does not reliably close the handle when init fails —
  // without this a failed task leaks a Chrome process (LOCAL) or a live
  // Browserbase session (BROWSERBASE) for the rest of the run.
  let stagehand: Stagehand;
  try {
    stagehand = await Stagehand.create({
      browser,
      // selfHeal defaults off on the server; without it the heal_* benchmarks
      // pass while measuring nothing.
      selfHeal: true,
      model: { modelName, apiKey } as NonNullable<StagehandCreateOptions["model"]>,
      ...(systemPrompt ? { systemPrompt } : {}),
      logging: { onLog: createStagehandOnLog(logger) },
    });
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }

  // Page acquisition failures need the same cleanup as create failures: the
  // client is up and the browser is running, and stagehand.close() alone
  // tears down the RPC client without closing the browser.
  let page: Page | null;
  try {
    page = await stagehand.browser.context.activePage();
    if (!page) {
      throw new Error("Stagehand init: Stagehand initialized without an active page");
    }
  } catch (error) {
    await stagehand.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }

  // No sessionUrl: StagehandBrowser is an opaque branded handle and does not
  // expose the Browserbase session id (#2517). To restore the Braintrust
  // click-through to a session replay, create the session first (as
  // core/targets/browserbase.ts does) and attach with
  // `browserbase.connect({ sessionId })`.
  return {
    stagehand,
    page,
  };
}
