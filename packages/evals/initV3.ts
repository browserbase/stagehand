/**
 * Initializes a V3 instance for use in evaluations without modifying
 * the existing Stagehand-based init flow. Tasks can gradually migrate
 * to consume `v3` directly.
 */

import type {
  AvailableCuaModel,
  AvailableModel,
  AgentConfig,
  AgentInstance,
  ClientOptions,
  LLMClient,
  LocalBrowserLaunchOptions,
  ModelConfiguration,
  V3Options
} from "@browserbasehq/orca";
import { loadApiKeyFromEnv, modelToAgentProviderMap, V3 } from "@browserbasehq/orca";
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
}: InitV3Args): Promise<V3InitResult> {
  // Determine if the requested model is a CUA model
  const isCUA = modelName in modelToAgentProviderMap;

  // If CUA, choose a safe internal AISDK model for V3 handlers based on available API keys
  let internalModel: AvailableModel = modelName;
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
        ? configOverrides.experimental
        : true,
    verbose: 2,
    includeCursor: false,
    browserbaseSessionCreateParams:
      configOverrides?.browserbaseSessionCreateParams,
    browserbaseSessionID: configOverrides?.browserbaseSessionID,
    selfHeal: true,
    disablePino: true,
    logger: logger.log.bind(logger),
  };

  if (!isCUA && llmClient) {
    v3Options.llmClient = llmClient;
  }

  const v3 = new V3(v3Options);

  // Associate the logger with the V3 instance
  logger.init(v3);
  await v3.init();

  const page = await v3.context.awaitActivePage();

  let agent: AgentInstance | undefined;
  if (createAgent) {
    let agentConfig: AgentConfig | undefined;
    if (isCUA) {
      if (modelName in modelToAgentProviderMap) {
        agentConfig = {
          model: modelName,
          provider: modelToAgentProviderMap[modelName],
      instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, YOU WILL ALWAYS BE PROVIDED WITH AN OPENED PAGE, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE. Simple perform the task provided, do not overthink or overdo it. The user trusts you to complete the task without any additional instructions, or answering any questions.`,
        } as AgentConfig;
      }
      const apiKey = loadApiKeyFromEnv(modelToAgentProviderMap[modelName], logger.log.bind(logger));
      agentConfig = {
        cua: true,
        model: {
          modelName: modelName as AvailableCuaModel,
          apiKey,
        },
      } as AgentConfig;
    } else {
      agentConfig = {
        model: modelName,
        executionModel: "google/gemini-2.5-flash",
      } as AgentConfig;
    }
    agent = v3.agent(agentConfig);
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
