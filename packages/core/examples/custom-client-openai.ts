/**
 * This example shows how to use a custom OpenAI client with Stagehand.
 *
 * The OpenAI API provides a simple, type-safe, and composable way to build AI applications.
 */
import { CustomOpenAIClient, Stagehand } from "../lib/v3/index.js";
import { z } from "zod";
import OpenAI from "openai";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    llmClient: new CustomOpenAIClient({
      modelName: "gpt-4.1-mini",
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
    }),
  });
  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://news.ycombinator.com");
  await stagehand.act("click on the 'new' link");

  const headlines = await stagehand.extract(
    "Extract the top 3 stories from the Hacker News homepage.",
    z.object({
      stories: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          points: z.number(),
        }),
      ),
    }),
  );

  console.log(headlines);

  await stagehand.close();
}

(async () => {
  await example();
})();
