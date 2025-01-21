/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { ObserveResult, Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();

  const page = await stagehand.page;

  let observePromise: Promise<ObserveResult[]>;

  page.on("popup", async (newPage) => {
    observePromise = newPage.observe({
      instruction: "return all the next possible actions from the page",
    });
  });

  await page.goto(
    "https://docs.browserbase.com/integrations/crew-ai/introduction",
  );

  await page.click(
    "#content-area > div.relative.mt-8.prose.prose-gray.dark\\:prose-invert > p:nth-child(2) > a",
  );

  await page.waitForTimeout(5000);

  if (observePromise) {
    const observeResult = await observePromise;

    console.log("Observed", observeResult.length, "actions");
  }

  await stagehand.close();
}

(async () => {
  await example();
})();
