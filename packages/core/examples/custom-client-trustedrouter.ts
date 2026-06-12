/**
 * This example shows how to use TrustedRouter through Stagehand's custom
 * OpenAI-compatible client.
 */
import { CustomOpenAIClient, Stagehand } from "../lib/v3/index.js";
import { z } from "zod";
import OpenAI from "openai";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    llmClient: new CustomOpenAIClient({
      modelName: "trustedrouter/zdr",
      client: new OpenAI({
        apiKey: process.env.TRUSTEDROUTER_API_KEY,
        baseURL: "https://api.trustedrouter.com/v1",
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
