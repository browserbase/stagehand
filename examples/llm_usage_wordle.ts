import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });

  await stagehand.init();

  const { text } = await stagehand.llmClient.generateText({
    prompt:
      "you are playing wordle. Return the 5-letter word that would be the best guess",
  });
  console.log(text);
  const { object } = await stagehand.llmClient.generateObject({
    prompt:
      "you are playing wordle. Return the 5-letter word that would be the best guess",
    schema: z.object({
      guess: z
        .string()
        .length(5)
        .describe("The 5-letter word that would be the best guess"),
    }),
  });
  console.log(object);
  await stagehand.close();
}

(async () => {
  await example();
})();
