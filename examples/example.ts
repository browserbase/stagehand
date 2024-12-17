/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "../lib";
import StagehandConfig from "./stagehand.config";

async function example() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();
}

(async () => {
  await example();
})();
