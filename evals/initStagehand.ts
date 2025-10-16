/**
 * This file provides a function to initialize a Stagehand instance for use in evaluations.
 * It configures the Stagehand environment and sets default options based on the current environment
 * (e.g., local or BROWSERBASE), caching preferences, and verbosity. It also establishes a logger for
 * capturing logs emitted by Stagehand.
 *
 * We create a central config object (`StagehandConfig`) that defines all parameters for Stagehand.
 *
 * The `initStagehand` function takes the model name, an optional DOM settling timeout, and an EvalLogger,
 * then uses these to override some default values before creating and initializing the Stagehand instance.
 */

import { enableCaching, env } from "./env";
import {
  ConstructorParams,
  LLMClient,
  Stagehand,
} from "@browserbasehq/stagehand";
import { EvalLogger } from "./logger";
import type { StagehandInitResult } from "@/types/evals";
import type { AgentConfig } from "@/dist";
import { AvailableModel } from "@browserbasehq/stagehand";
import { modelToAgentProviderMap } from "@/lib/agent/AgentProvider";

/**
 * StagehandConfig:
 * This configuration object follows a similar pattern to `examples/stagehand.config.ts`.
 * It sets the environment, verbosity, caching preferences, and other defaults. Some values,
 * like `apiKey` and `projectId`, can be defined via environment variables if needed.
 *
 * Adjust or remove fields as appropriate for your environment.
 */
// Base configuration without async values
const BaseStagehandConfig = {
  env: env,
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  useAPI: process.env.USE_API === "true",
  verbose: 2 as const,
  debugDom: true,
  headless: false,
  enableCaching,
  domSettleTimeoutMs: 60_000,
  disablePino: true,
  selfHeal: true,
  modelName: "google/gemini-2.5-flash",
  modelClientOptions: {
    apiKey: process.env.GEMINI_API_KEY,
  },
};

/**
 * Initializes a Stagehand instance for a given model:
 * - modelName: The model to use (overrides default in StagehandConfig)
 * - domSettleTimeoutMs: Optional timeout for DOM settling operations
 * - logger: An EvalLogger instance for capturing logs
 *
 * Returns:
 * - stagehand: The initialized Stagehand instance
 * - logger: The provided logger, associated with the Stagehand instance
 * - initResponse: Any response data returned by Stagehand initialization
 */
export const initStagehand = async ({
  llmClient,
  modelClientOptions,
  domSettleTimeoutMs,
  logger,
  configOverrides,
  actTimeoutMs,
  modelName,
}: {
  llmClient?: LLMClient;
  modelClientOptions?: { apiKey: string };
  domSettleTimeoutMs?: number;
  logger: EvalLogger;
  configOverrides?: Partial<ConstructorParams>;
  actTimeoutMs?: number;
  modelName: AvailableModel;
}): Promise<StagehandInitResult> => {
  const config = {
    ...BaseStagehandConfig,
    modelClientOptions,
    llmClient,
    ...(domSettleTimeoutMs && { domSettleTimeoutMs }),
    actTimeoutMs,
    modelName,
    experimental:
      typeof configOverrides?.experimental === "boolean"
        ? configOverrides.experimental
        : !BaseStagehandConfig.useAPI,
    browserbaseSessionCreateParams: {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      // proxies: true,
      browserSettings: {
        enablePdfViewer: true,
        // advancedStealth: true,
        // os: "windows",
        viewport: {
          width: 1288,
          height: 711,
        },
      },
    },
    ...configOverrides,
    logger: logger.log.bind(logger),
  };

  try {
    const stagehand = new Stagehand(config);

    // Associate the logger with the Stagehand instance
    logger.init(stagehand);

    const { debugUrl, sessionUrl } = await stagehand.init();

    // Set navigation timeout to 60 seconds for evaluations
    stagehand.context.setDefaultNavigationTimeout(60_000);

    let agentConfig: AgentConfig | undefined;
    if (modelName in modelToAgentProviderMap) {
      agentConfig = {
        model: modelName,
        provider: modelToAgentProviderMap[modelName],
        instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await stagehand.page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE. Simply perform the task provided, do not overthink or overdo it. The user trusts you to complete the task without any additional instructions, or answering any questions.`,
      } as AgentConfig;
    }

    const agent = stagehand.agent(agentConfig);

    return {
      stagehand,
      stagehandConfig: config,
      logger,
      debugUrl,
      sessionUrl,
      modelName,
      agent,
    };
  } catch (error) {
    console.error("Error initializing stagehand:", error);
    throw error;
  }
};
