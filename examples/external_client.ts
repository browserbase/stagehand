import { Stagehand } from "../lib";
import { z } from "zod";
import { OllamaClient } from "./external_clients/ollama";
import StagehandConfig from "./stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    llmClient: new OllamaClient({
      modelName: "llama3.2",
    }),
  });

  await stagehand.init();
  await stagehand.page.goto("https://news.ycombinator.com");

  const headlines = await stagehand.page.extract({
    instruction: "Extract only 3 stories from the Hacker News homepage.",
    schema: z.object({
      stories: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
            points: z.number(),
          }),
        )
        .length(3),
    }),
  });

  console.log(headlines);

  await stagehand.close();
}

(async () => {
  await example();
})();
