/**
 * This example shows how to use the Vercel AI SDK to power the Stagehand LLM Client.
 *
 * You will need to reference the AI SDK Client in /external_clients/aisdk.ts
 *
 * To learn more about the Vercel AI SDK, see: https://sdk.vercel.ai/docs
 */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import { AISdkClient } from "./external_clients/aisdk";
import { z } from "zod/v3";
import { openai } from "@ai-sdk/openai";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    llmClient: new AISdkClient({
      model: openai("gpt-4o"),
    }),
  });

  await stagehand.init();
  const page = stagehand.page;

  await page.goto("https://news.ycombinator.com");

  const { story } = await page.extract({
    instruction: "extract the title of the top story on the page",
    schema: z.object({
      story: z.string().describe("the top story on the page"),
    }),
  });

  console.log("The top story is:", story);
  await page.act("click the first story");

  await stagehand.close();
}

(async () => {
  await example();
})();
