import { default as DefaultStagehandConfig } from "@/stagehand.config";
import type { ConstructorParams } from "@/dist";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const StagehandConfig: ConstructorParams = {
  ...DefaultStagehandConfig,
  env: "BROWSERBASE" /* Environment to run Stagehand in */,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  },
};
export default StagehandConfig;
