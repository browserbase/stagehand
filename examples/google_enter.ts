/**
 * This example shows how to use the Stagehand agent to navigate to Google and search for "Browserbase".
 *
 * It's mainly meant to sanity check using page.act() to press enter, since some LLMs have issues with it.
 */

import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.goto("https://google.com");
  await page.act("type in 'Browserbase'");
  await page.act("press enter");
  await stagehand.close();
}

(async () => {
  await example();
})();
