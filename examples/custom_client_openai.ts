/**
 * This example shows how to use a custom OpenAI client with Stagehand.
 *
 * The OpenAI API provides a simple, type-safe, and composable way to build AI applications.
 *
 * You will need to reference the Custom OpenAI Client in /external_clients/customOpenAI.ts
 */
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v3";
import { CustomOpenAIClient } from "./external_clients/customOpenAI";
import StagehandConfig from "@/stagehand.config";
import OpenAI from "openai";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    llmClient: new CustomOpenAIClient({
      modelName: "gpt-4o-mini",
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
    }),
  });
  await stagehand.init();

  const page = stagehand.page;
  await page.goto("https://news.ycombinator.com");
  await page.act("click on the 'new' link");

  const headlines = await page.extract({
    instruction: "Extract the top 3 stories from the Hacker News homepage.",
    schema: z.object({
      stories: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          points: z.number(),
        }),
      ),
    }),
  });

  console.log(headlines);

  await stagehand.close();
}

(async () => {
  await example();
})();
