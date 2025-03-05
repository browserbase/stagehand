/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { AvailableModel, Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    modelName: "braintrust-claude-3-7-sonnet-latest" as AvailableModel,
    modelClientOptions: {
      apiKey: process.env.BRAINTRUST_API_KEY,
    },
    env: "LOCAL",
  });
  await stagehand.init();
  await stagehand.page.goto("https://docs.stagehand.dev");
  const result = await stagehand.page.extract({
    instruction: "get the heading",
    schema: z.object({
      heading: z.string().describe("The heading of the page"),
    }),
    useTextExtract: true,
  });
  console.log(result);
  await stagehand.close();
}

(async () => {
  await example();
})();
