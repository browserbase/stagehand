import type { ConstructorParams } from "@/dist";
import dotenv from "dotenv";
dotenv.config();

const StagehandConfig: ConstructorParams = {
  verbose: 0 /* Verbosity level for logging: 0 = silent, 1 = info, 2 = all */,
  domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,

  useAPI: false,
  //   LLM configuration
  modelName:
    "anthropic/claude-sonnet-4-20250514" /* Name of the model to use */,
  modelClientOptions: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  } /* Configuration options for the model client */,

  // Browser configuration
  env: "LOCAL",
  apiKey: process.env.BROWSERBASE_API_KEY /* API key for authentication */,
  projectId: process.env.BROWSERBASE_PROJECT_ID /* Project identifier */,
  browserbaseSessionID:
    undefined /* Session ID for resuming Browserbase sessions */,
  browserbaseSessionCreateParams: {
    proxies: false,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      blockAds: true,
      viewport: {
        width: 1024,
        height: 768,
      },
      advancedStealth: true,
    },
  },
  localBrowserLaunchOptions: {
    headless: false,
    viewport: {
      width: 1024,
      height: 768,
    },
  } /* Configuration options for the local browser */,
};
export default StagehandConfig;
