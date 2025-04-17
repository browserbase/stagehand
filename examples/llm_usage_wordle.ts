import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  const prompt =
    "you are playing wordle. Return the 5-letter word that would be the best guess";
  await stagehand.init();
  console.log("---Generating Text---");
  const { text } = await stagehand.llmClient.generateText({
    prompt: prompt,
  });
  console.log(text);

  console.log("---Generating Object---");
  const { object } = await stagehand.llmClient.generateObject({
    prompt: prompt,
    schema: z.object({
      guess: z
        .string()
        .describe("The 5-letter word that would be the best guess"),
    }),
  });
  console.log(object);

  console.log("---Streaming Text---");
  const { textStream } = await stagehand.llmClient.streamText({
    prompt: prompt,
  });

  for await (const textPart of textStream) {
    process.stdout.write(textPart);
  }

  await stagehand.close();
}

(async () => {
  await example();
})();
