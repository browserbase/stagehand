/**
 * This example shows how to use custom instructions with Stagehand.
 */
import { Stagehand } from "../lib";
import StagehandConfig from "./stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    instructions:
      "You are a shopping agent based in the United States. When selecting a size, convert the user's input from UK sizes to US sizes. For example if the user says size 7, you use size 9.",
  });
  await stagehand.init();

  const page = stagehand.page;

  await page.goto("https://www.nike.com/my/t/v2k-run-shoes-4P7Wl1/HJ4497-100");

  await page.act({
    action: "select size 7 and add it to cart",
  });

  await page.waitForTimeout(5000);

  await stagehand.close();
}

(async () => {
  await example();
})();
