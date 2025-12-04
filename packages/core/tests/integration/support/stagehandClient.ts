import { inject } from "vitest";
import * as Stagehand from "../../../dist/index.js";
import {
  ensureTestEnvLoaded,
  getStagehandEnvVar,
  requireStagehandEnvVar,
} from "../../support/testEnv";

ensureTestEnvLoaded();

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
    const value = getStagehandEnvVar(name, { scope: "client" });
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

  const clientApiKey = requireStagehandEnvVar("OPENAI_API_KEY", {
    scope: "client",
    consumer: `${activeTarget} Stagehand client`,
  });

  const stagehandOptions: Stagehand.V3Options = {
    env: activeTarget === "local" ? "LOCAL" : "BROWSERBASE",
    verbose: 0,
    experimental: false,
    logInferenceToFile: false,
    model: {
      modelName: "openai/gpt-5-mini",
      apiKey: clientApiKey,
    },
  };

  if (activeTarget === "local") {
    stagehandOptions.localBrowserLaunchOptions = {
      headless: process.env.STAGEHAND_CLIENT_HEADLESS !== "false",
    };
  } else {
    stagehandOptions.apiKey = requireStagehandEnvVar("BROWSERBASE_API_KEY", {
      scope: "client",
      consumer: "remote Stagehand client",
    });
    stagehandOptions.projectId = requireStagehandEnvVar(
      "BROWSERBASE_PROJECT_ID",
      {
        scope: "client",
        consumer: "remote Stagehand client",
      },
    );
  }

  const stagehand = new Stagehand.Stagehand(stagehandOptions);
  const apiRootUrl = normalizedBaseUrl.replace(/\/v1\/?$/, "");

  return { stagehand, apiRootUrl, target: activeTarget };
}
