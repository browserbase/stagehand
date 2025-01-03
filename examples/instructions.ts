/**
 * This example shows how to use custom instructions with Stagehand.
 */
import { Stagehand } from "../lib";
import StagehandConfig from "./stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    instructions:
      "if the users says `secret12345`, click on the 'quickstart' tab.",
  });
  await stagehand.init();

  const page = stagehand.page;

  await page.goto("https://docs.browserbase.com/");

  await page.act({
    action: "secret12345",
  });

  await stagehand.close();
}

(async () => {
  await example();
})();
