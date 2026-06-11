/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */
import { Stagehand } from "@browserbasehq/stagehand";

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
    env: "LOCAL",
    modelName: "openai/gpt-4.1-mini" /* Name of the model to use */,
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  await stagehand.init();
  await example(stagehand);
  // await stagehand.close();
})();
