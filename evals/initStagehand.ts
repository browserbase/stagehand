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
import { AvailableModel, ConstructorParams, LogLine, Stagehand } from "../lib";
import { EvalLogger } from "./logger";

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
  verbose: 2 as const,
  debugDom: true,
  headless: false,
  enableCaching,
  domSettleTimeoutMs: 30_000,
  modelName: "gpt-4o", // default model, can be overridden by initStagehand arguments
  modelClientOptions: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  logger: (logLine: LogLine) =>
    console.log(`[stagehand::${logLine.category}] ${logLine.message}`),
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
  modelName,
  domSettleTimeoutMs,
  logger,
  configOverrides,
}: {
  modelName: AvailableModel;
  domSettleTimeoutMs?: number;
  logger: EvalLogger;
  configOverrides?: Partial<ConstructorParams>;
}) => {
  let chosenApiKey: string | undefined = process.env.OPENAI_API_KEY;
  if (modelName.startsWith("claude")) {
    chosenApiKey = process.env.ANTHROPIC_API_KEY;
  }

  const config = {
    ...StagehandConfig,
    modelName,
    ...(domSettleTimeoutMs && { domSettleTimeoutMs }),
    modelClientOptions: {
      apiKey: chosenApiKey,
    },
    logger: (logLine: LogLine) => {
      logger.log(logLine);
    },
    ...configOverrides,
  };

  const stagehand = new Stagehand(config);

  // Associate the logger with the Stagehand instance
  logger.init(stagehand);

  const initResponse = await stagehand.init();
  return { stagehand, logger, initResponse };
};
