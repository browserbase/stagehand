import { Stagehand } from "@/dist";
import { z } from "zod";
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
  await stagehand.page.goto("https://news.ycombinator.com");
  await stagehand.page.act("click on the 'new' link");

  const headlines = await stagehand.page.extract({
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
