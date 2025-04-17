import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
// import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });

  await stagehand.init();

  const { textStream } = await stagehand.llmClient.streamText({
    prompt:
      "you are playing wordle. Return the 5-letter word that would be the best guess",
  });

  for await (const textPart of textStream) {
    process.stdout.write(textPart);
  }

  await stagehand.close();
}

(async () => {
  await example();
})();
