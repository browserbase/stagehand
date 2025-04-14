import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";

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
  await stagehand.close();
}

(async () => {
  await example();
})();
