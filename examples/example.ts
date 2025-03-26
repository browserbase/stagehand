/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import Browserbase from "@browserbasehq/sdk";
async function example() {
  const bb = new Browserbase();
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  });
  const stagehand = new Stagehand({
    ...StagehandConfig,
    browserbaseSessionID: session.id,
  });
  await stagehand.init();
  console.log("session", session.id);
  console.log("stagehand", stagehand.browserbaseSessionID);

  const page = stagehand.page;
  const url = "https://docs.stagehand.dev/get_started/introduction";
  await page.goto(url);

  console.log("session", session.id);
  console.log("stagehand", stagehand.browserbaseSessionID);

  await stagehand.close();
}

(async () => {
  await example();
})();
