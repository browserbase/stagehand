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
import { AvailableModel } from "@browserbasehq/stagehand";

/**
 * StagehandConfig:
 * This configuration object follows a similar pattern to `examples/stagehand.config.ts`.
 * It sets the environment, verbosity, caching preferences, and other defaults. Some values,
 * like `apiKey` and `projectId`, can be defined via environment variables if needed.
 *
 * Adjust or remove fields as appropriate for your environment.
 */
const StagehandConfig = {
  env: env,
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  useAPI: process.env.USE_API === "true",
  verbose: 2 as const,
  debugDom: true,
  headless: false,
  enableCaching,
  domSettleTimeoutMs: 30_000,
  disablePino: true,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      viewport: {
        width: 1024,
        height: 768,
      },
    },
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
    ...StagehandConfig,
    modelClientOptions,
    llmClient,
    ...(domSettleTimeoutMs && { domSettleTimeoutMs }),
    actTimeoutMs,
    modelName,
    experimental:
      typeof configOverrides?.experimental === "boolean"
        ? configOverrides.experimental
        : !StagehandConfig.useAPI,
    ...configOverrides,
    logger: logger.log.bind(logger),
  };

  const stagehand = new Stagehand(config);

  // Associate the logger with the Stagehand instance
  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

  // Set navigation timeout to 60 seconds for evaluations
  stagehand.context.setDefaultNavigationTimeout(60_000);

  return {
    stagehand,
    stagehandConfig: config,
    logger,
    debugUrl,
    sessionUrl,
    modelName,
  };
};
