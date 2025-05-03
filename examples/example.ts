/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  /**
   * Add your code here!
   */
  await stagehand.page.goto("https://docs.stagehand.dev");
  await stagehand.page.act("click the quickstart button");
  await stagehand.close();
}

(async () => {
  await example();
})();
