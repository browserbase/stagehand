import { default as DefaultStagehandConfig } from "@/stagehand.config";
import type { ConstructorParams } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const StagehandConfig: ConstructorParams = {
  ...DefaultStagehandConfig,
  env: "LOCAL" /* Environment to run Stagehand in */,
  verbose: 1 /* Logging verbosity level (0=quiet, 1=normal, 2=verbose) */,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  },
  enableCaching: false /* Enable caching functionality */,
  localBrowserLaunchOptions: {
    headless: true /* Run browser in headless mode */,
  },
};
export default StagehandConfig;
