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

  const { page } = stagehand;

  await page.goto("https://www.google.com");

  await page.act({
    action: 'Type "Sameel Arif" in the search bar',
  });

  await page.act({
    action: "Click the search button",
  });

  await page.act({
    action: "Click the first result",
  });
}

(async () => {
  await example();
})();
