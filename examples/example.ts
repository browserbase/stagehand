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
  const modelName = "cerebras-llama-3.3-70b";
  //   const modelName = "gemini-2.0-flash";
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    modelName,
    modelClientOptions: {
      apiKey:
        modelName === ("gemini-2.0-flash" as AvailableModel)
          ? process.env.GOOGLE_API_KEY
          : process.env.CEREBRAS_API_KEY,
    },
  });
  await stagehand.init();
  await stagehand.page.goto("https://docs.stagehand.dev");
  await stagehand.page.act("Click the quickstart");
  const { text } = await stagehand.page.extract({
    instruction: "Extract the title",
    schema: z.object({
      text: z.string(),
    }),
    useTextExtract: true,
  });
  console.log(text);
  await stagehand.close();
}

(async () => {
  await example();
})();
