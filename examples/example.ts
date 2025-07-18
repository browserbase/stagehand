/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.page;
  await page.goto("https://docs.stagehand.dev");
  await page.act("click the quickstart button");
}

(async () => {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  await example(stagehand);
  await stagehand.close();
})();
