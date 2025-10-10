/**
 * This example shows how to use the Stagehand agent to navigate to Google and search for "Browserbase".
 *
 * It's mainly meant to sanity check using page.act() to press enter, since some LLMs have issues with it.
 */

import { Stagehand } from "../lib/v3";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  await page.goto("https://google.com");
  await stagehand.act("type in 'Browserbase'");
  await stagehand.act("press enter");
  await stagehand.close();
}

(async () => {
  await example();
})();
