import type { ConstructorParams } from "@/dist";
import dotenv from "dotenv";
dotenv.config();

const StagehandConfig: ConstructorParams = {
  verbose: 2 /* Verbosity level for logging: 0 = silent, 1 = info, 2 = all */,
  domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,

  //   LLM configuration
  modelName: "gpt-4o" /* Name of the model to use */,
  modelClientOptions: {
    apiKey: process.env.OPENAI_API_KEY,
  } /* Configuration options for the model client */,

  // Browser configuration
  env:
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
      ? "BROWSERBASE"
      : "LOCAL",
  apiKey: process.env.BROWSERBASE_API_KEY /* API key for authentication */,
  projectId: process.env.BROWSERBASE_PROJECT_ID /* Project identifier */,
  browserbaseSessionID:
    undefined /* Session ID for resuming Browserbase sessions */,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      advancedStealth: true,
      blockAds: true,
      // @ts-expect-error - os is not a valid property in the BrowserSettings type
      os: "windows",
      viewport: {
        width: 2560,
        height: 1440,
      },
    },
  },
  localBrowserLaunchOptions: {
    headless: false,
    viewport: {
      width: 1288,
      height: 711,
    },
  } /* Configuration options for the local browser */,
  experimental: false, // Enable experimental features
};
export default StagehandConfig;
