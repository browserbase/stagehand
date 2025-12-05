/**
 * Initializes a V3 instance for use in evaluations without modifying
 * the existing Stagehand-based init flow. Tasks can gradually migrate
 * to consume `v3` directly.
 */

import type {
  AvailableCuaModel,
  AvailableModel,
  AgentInstance,
  ClientOptions,
  LLMClient,
  LocalBrowserLaunchOptions,
  ModelConfiguration,
  V3Options,
  AgentModelConfig,
} from "@browserbasehq/stagehand";
import {
  loadApiKeyFromEnv,
  modelToAgentProviderMap,
  V3,
} from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import { env } from "./env";
import { EvalLogger } from "./logger";

dotenv.config();

type InitV3Args = {
  llmClient?: LLMClient;
  modelClientOptions?: ClientOptions;
  domSettleTimeoutMs?: number; // retained for parity; v3 handlers accept timeouts per-call
  logger: EvalLogger;
  createAgent?: boolean; // only create an agent for agent tasks
  isCUA?: boolean;
  configOverrides?: {
    localBrowserLaunchOptions?: Partial<
      Pick<LocalBrowserLaunchOptions, "headless" | "args">
    >;
    // Back-compat alias for args
    chromeFlags?: string[];
    browserbaseSessionCreateParams?: V3Options["browserbaseSessionCreateParams"];
    browserbaseSessionID?: V3Options["browserbaseSessionID"];
    experimental?: boolean;
  };
  actTimeoutMs?: number; // retained for parity (v3 agent tools don't use this globally)
  modelName: AvailableModel;
};

export type V3InitResult = {
  v3: V3;
  logger: EvalLogger;
  debugUrl?: string; // not exposed by v3; placeholder for parity
  sessionUrl?: string; // not exposed by v3; placeholder for parity
  modelName: AvailableModel;
  agent?: AgentInstance;
};

export async function initV3({
  llmClient,
  modelClientOptions,
  logger,
  configOverrides,
  modelName,
  createAgent,
  isCUA,
}: InitV3Args): Promise<V3InitResult> {
  // If CUA, choose a safe internal AISDK model for V3 handlers based on available API keys
  let internalModel: AvailableModel = modelName;
  if (isCUA) {
    if (process.env.OPENAI_API_KEY)
      internalModel = "openai/gpt-4.1-mini" as AvailableModel;
    else if (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    )
      internalModel = "google/gemini-2.0-flash" as AvailableModel;
    else if (process.env.ANTHROPIC_API_KEY)
      internalModel = "anthropic/claude-3-7-sonnet-latest" as AvailableModel;
    else
      throw new Error(
        "V3 init: No AISDK API key found. Set one of OPENAI_API_KEY, GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY, or ANTHROPIC_API_KEY to run CUA evals.",
      );
  }

  const resolvedModelConfig: ModelConfiguration =
    !isCUA && modelClientOptions
      ? ({
          ...modelClientOptions,
          modelName: internalModel,
        } as ModelConfiguration)
      : internalModel;

  const v3Options: V3Options = {
    env,
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    localBrowserLaunchOptions: {
      headless: configOverrides?.localBrowserLaunchOptions?.headless ?? false,
      args:
        configOverrides?.localBrowserLaunchOptions?.args ??
        configOverrides?.chromeFlags,
    },
    model: resolvedModelConfig,
    experimental:
      typeof configOverrides?.experimental === "boolean"
        ? configOverrides.experimental && process.env.USE_API !== "true" // experimental only when not using API
        : false,
    verbose: 2,
    browserbaseSessionCreateParams:
      configOverrides?.browserbaseSessionCreateParams,
    browserbaseSessionID: configOverrides?.browserbaseSessionID,
    selfHeal: true,
    disablePino: true,
    disableAPI: process.env.USE_API !== "true", // Negate: USE_API=true → disableAPI=false
    logger: logger.log.bind(logger),
  };

  if (!isCUA && llmClient) {
    v3Options.llmClient = llmClient;
  }

  const v3 = new V3(v3Options);

  // Associate the logger with the V3 instance
  logger.init(v3);
  await v3.init();

  let agent: AgentInstance | undefined;
  if (createAgent) {
    if (isCUA) {
      const shortModelName = modelName.includes("/")
        ? modelName.split("/")[1]
        : modelName;

      const providerType = modelToAgentProviderMap[shortModelName];
      if (!providerType) {
        throw new Error(
          `CUA model "${shortModelName}" not found in modelToAgentProviderMap. ` +
            `Available: ${Object.keys(modelToAgentProviderMap).join(", ")}`,
        );
      }

      const apiKey = loadApiKeyFromEnv(providerType, logger.log.bind(logger));

      const cuaModel: AvailableCuaModel | AgentModelConfig<AvailableCuaModel> =
        apiKey && apiKey.length > 0
          ? {
              modelName: modelName as AvailableCuaModel,
              apiKey,
            }
          : (modelName as AvailableCuaModel);

      agent = v3.agent({
        cua: true,
        model: cuaModel,
        systemPrompt: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, YOU WILL ALWAYS BE PROVIDED WITH AN OPENED PAGE, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE. Simple perform the task provided, do not overthink or overdo it. The user trusts you to complete the task without any additional instructions, or answering any questions.`,
      });
    } else {
      agent = v3.agent({
        model: modelName,
        executionModel: "google/gemini-2.5-flash",
      });
    }
  }

  return {
    v3,
    logger,
    debugUrl: "",
    sessionUrl: "",
    modelName,
    agent,
  };
}
