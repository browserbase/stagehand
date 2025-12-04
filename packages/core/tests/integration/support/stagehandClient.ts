import { inject } from "vitest";
import * as Stagehand from "../../../dist/index.js";

type TestTarget = "remote" | "local";

const REMOTE_REQUIRED_VARS = [
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "OPENAI_API_KEY",
];

const LOCAL_REQUIRED_VARS = ["OPENAI_API_KEY"];

export function resolveTestTarget(): TestTarget {
  const providedTarget = inject(
    "STAGEHAND_TEST_TARGET",
  ) as string | undefined;
  const normalized =
    providedTarget ?? process.env.STAGEHAND_TEST_TARGET ?? "local";
  return normalized.toLowerCase() === "local" ? "local" : "remote";
}

export function getMissingClientEnvVars(target: TestTarget): string[] {
  const required =
    target === "remote" ? REMOTE_REQUIRED_VARS : LOCAL_REQUIRED_VARS;
  return required.filter((name) => {
    const value = process.env[name];
    return !value || value.length === 0;
  });
}

export function createStagehandHarness(target?: TestTarget) {
  const activeTarget = target ?? resolveTestTarget();
  const providedBaseUrl = inject("STAGEHAND_BASE_URL") as string | undefined;
  if (!providedBaseUrl) {
    throw new Error("STAGEHAND_BASE_URL was not provided by globalSetup.");
  }

  const normalizedBaseUrl = providedBaseUrl.endsWith("/v1")
    ? providedBaseUrl
    : `${providedBaseUrl.replace(/\/$/, "")}/v1`;

  process.env.STAGEHAND_API_URL = normalizedBaseUrl;

  const stagehandOptions: Record<string, unknown> = {
    env: "BROWSERBASE",
    verbose: 0,
    disableAPI: false,
    experimental: false,
    logInferenceToFile: false,
  };

  if (activeTarget === "local") {
    const clientApiKey =
      process.env.STAGEHAND_CLIENT_MODEL_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!clientApiKey) {
      throw new Error(
        "Missing STAGEHAND_CLIENT_MODEL_API_KEY or OPENAI_API_KEY for local client.",
      );
    }

    stagehandOptions.model =
      process.env.STAGEHAND_CLIENT_MODEL ??
      process.env.STAGEHAND_SERVER_MODEL ??
      "openai/gpt-4o-mini";
    stagehandOptions.modelClientOptions = {
      apiKey: clientApiKey,
      baseURL: process.env.STAGEHAND_CLIENT_MODEL_BASE_URL,
    };
  }

  const stagehand = new Stagehand.Stagehand(stagehandOptions);

  const apiRootUrl = normalizedBaseUrl.replace(/\/v1\/?$/, "");

  return { stagehand, apiRootUrl, target: activeTarget };
}
