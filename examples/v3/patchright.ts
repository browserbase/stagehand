import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "patchright-core";
import { z } from "zod/v3";

async function example(stagehand: Stagehand) {
  const browser = await chromium.connectOverCDP({
    wsEndpoint: stagehand.connectURL(),
  });

  const prContext = browser.contexts()[0];
  const prPage = prContext.pages()[0];
  await prPage.goto("https://github.com/microsoft/playwright/issues/30261");

  await stagehand.act({
    instruction: "scroll to the bottom of the page",
    page: prPage,
  });

  const { reason } = await stagehand.extract({
    instruction: "extract the reason why playwright doesn't expose frame IDs",
    reason: z.string(),
    // page arg not required
  });
  console.log(reason);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    modelName: "openai/gpt-4.1",
  });
  await stagehand.init();
  await example(stagehand);
})();
