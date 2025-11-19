import { Stagehand } from "../../lib/v3";
import { chromium } from "playwright-core";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  const browser = await chromium.connectOverCDP({
    wsEndpoint: stagehand.connectURL(),
  });
  const pwContext = browser.contexts()[0];
  const pwPage1 = pwContext.pages()[0];
  await pwPage1.goto("https://docs.stagehand.dev/first-steps/introduction");

  const pwPage2 = await pwContext.newPage();
  await pwPage2.goto("https://docs.stagehand.dev/configuration/observability");

  const [page1Extraction, page2Extraction] = await Promise.all([
    stagehand.extract(
      "extract the names of the four stagehand primitives",
      z.array(z.string()),
      { page: pwPage1 },
    ),
    stagehand.extract(
      "extract the list of session dashboard features",
      z.array(z.string()),
      { page: pwPage2 },
    ),
  ]);

  console.log(page1Extraction);
  console.log(page2Extraction);
}

(async () => {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    model: "openai/gpt-4.1",
  });
  await stagehand.init();
  await example(stagehand);
})();
