import type { ConstructorParams, LogLine } from "../../lib";

const StagehandConfig: ConstructorParams = {
  env: "LOCAL" /* Environment to run Stagehand in */,
  apiKey: process.env.BROWSERBASE_API_KEY! /* API key for authentication */,
  projectId: process.env.BROWSERBASE_PROJECT_ID! /* Project identifier */,
  verbose: 1 /* Logging verbosity level (0=quiet, 1=normal, 2=verbose) */,
  debugDom: true /* Enable DOM debugging features */,
  headless: true /* Run browser in headless mode */,
  logger: (message: LogLine) =>
    console.log(
      `[stagehand::${message.category}] ${message.message}`,
    ) /* Custom logging function */,
  domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
  },
  enableCaching: true /* Enable caching functionality */,
  browserbaseSessionID:
    undefined /* Session ID for resuming Browserbase sessions */,
  modelName: "gpt-4o" /* Name of the model to use */,
  modelClientOptions: {
    apiKey: process.env.OPENAI_API_KEY,
  } /* Configuration options for the model client */,
};
export default StagehandConfig;
