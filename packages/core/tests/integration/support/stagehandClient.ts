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

  const stagehandOptions: Record<string, unknown> = {};

  if (activeTarget === "local") {
    const clientApiKey = process.env.OPENAI_API_KEY;
    if (!clientApiKey) {
      throw new Error(
          "Missing OPENAI_API_KEY for local client.",
      );
    }

    const stagehand = new Stagehand.Stagehand({
      env: "BROWSERBASE",
      verbose: 0,
      model: {
        modelName: "openai/gpt-5-mini",
        apiKey: clientApiKey,
      },
      experimental: false,
      logInferenceToFile: false,
    });

    const apiRootUrl = normalizedBaseUrl.replace(/\/v1\/?$/, "");

    return {stagehand, apiRootUrl, target: activeTarget};
  }
}