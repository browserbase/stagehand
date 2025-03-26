import { default as DefaultStagehandConfig } from "@/stagehand.config";
import type { ConstructorParams } from "@/dist";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const StagehandConfig: ConstructorParams = {
  ...DefaultStagehandConfig,
  env: "LOCAL" /* Environment to run Stagehand in */,
  headless: true /* Run browser in headless mode */,
};
export default StagehandConfig;
