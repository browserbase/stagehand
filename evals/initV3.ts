/**
 * Initializes a V3 instance for use in evaluations without modifying
 * the existing Stagehand-based init flow. Tasks can gradually migrate
 * to consume `v3` directly.
 */

import dotenv from "dotenv";
import { enableCaching, env } from "./env";
import { EvalLogger } from "./logger";
import type { AvailableModel, ClientOptions } from "@/types/model";
import type { LLMClient } from "@/lib/llm/LLMClient";
import { V3 } from "@/lib/v3/v3";
import type { AgentInstance } from "@/types/agent";
import type { V3Options } from "@/lib/v3/types";
import { AgentConfig } from "@/types/stagehand";

dotenv.config();

type InitV3Args = {
  llmClient?: LLMClient;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number; // retained for parity; v3 handlers accept timeouts per-call
  logger: EvalLogger;
  configOverrides?: Partial<
    Pick<
      V3Options,
      | "headless"
      | "chromeFlags"
      | "browserbaseSessionCreateParams"
      | "browserbaseSessionID"
      | "experimental"
    >
  >;
  actTimeoutMs?: number; // retained for parity (v3 agent tools don't use this globally)
  modelName: AvailableModel;
};

export type V3InitResult = {
  v3: V3;
  logger: EvalLogger;
  debugUrl?: string; // not exposed by v3; placeholder for parity
  sessionUrl?: string; // not exposed by v3; placeholder for parity
  modelName: AvailableModel;
  agent: AgentInstance;
};

export async function initV3({
  llmClient,
  modelClientOptions,
  logger,
  configOverrides,
  modelName,
}: InitV3Args): Promise<V3InitResult> {
  // Determine if the requested model is a CUA model (OpenAI/Anthropic computer-use)
  const baseName = modelName.includes("/")
    ? modelName.split("/")[1]
    : modelName;
  const isCUA =
    baseName.includes("computer-use-preview") ||
    baseName.startsWith("claude") ||
    baseName.includes("claude-sonnet-4") ||
    baseName.includes("claude-3-7-sonnet-latest");

  // If CUA, choose a safe internal AISDK model for V3 handlers based on available API keys
  let internalModel: AvailableModel = modelName;
  let v3ClientOpts: {
    modelClientOptions?: ClientOptions;
    llmClient?: LLMClient;
  } = {};
  if (isCUA) {
    if (process.env.OPENAI_API_KEY)
      internalModel = "openai/gpt-4.1-mini" as AvailableModel;
    else if (
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    )
      internalModel = "google/gemini-2.0-flash" as AvailableModel;
    else if (process.env.ANTHROPIC_API_KEY)
      internalModel = "anthropic/claude-3-7-sonnet-latest" as AvailableModel;
    else
      throw new Error(
        "V3 init: No AISDK API key found. Set one of OPENAI_API_KEY, GOOGLE_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY, or ANTHROPIC_API_KEY to run CUA evals.",
      );
    // For CUA, avoid injecting an external llmClient bound to a different model; let V3 pick from env
    v3ClientOpts = {};
  } else {
    v3ClientOpts = { modelClientOptions, llmClient };
  }

  const v3 = new V3({
    env,
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    headless: configOverrides?.headless ?? false,
    chromeFlags: configOverrides?.chromeFlags,
    modelName: internalModel,
    ...v3ClientOpts,
    enableCaching,
    experimental:
      typeof configOverrides?.experimental === "boolean"
        ? configOverrides.experimental
        : true,
    verbose: 2,
    includeCursor: false,
    browserbaseSessionCreateParams:
      configOverrides?.browserbaseSessionCreateParams as V3Options["browserbaseSessionCreateParams"],
    browserbaseSessionID: configOverrides?.browserbaseSessionID,
    selfHeal: true,
    disablePino: true,
    logger: logger.log.bind(logger),
  });

  // Associate the logger with the V3 instance
  logger.init(v3);
  await v3.init();

  const isCUAModel = (model: string): boolean =>
    model.includes("computer-use-preview") || model.startsWith("claude");

  let agentConfig: AgentConfig | undefined;
  if (isCUAModel(modelName)) {
    const base = modelName.includes("/") ? modelName.split("/")[1] : modelName;
    const provider = base.startsWith("claude") ? "anthropic" : "openai";
    const apiKey =
      provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        `Missing API key for ${provider}. Set ${
          provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
        } in your environment.`,
      );
    }
    agentConfig = {
      model: modelName,
      provider,
      options: { apiKey },
    } as AgentConfig;
  } else {
    agentConfig = {
      model: modelName,
      executionModel: "google/gemini-2.5-flash",
    } as AgentConfig;
  }

  const agent = v3.agent(agentConfig);

  return {
    v3,
    logger,
    debugUrl: "",
    sessionUrl: "",
    modelName,
    agent,
  };
}
