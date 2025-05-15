import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.goto("https://www.nytimes.com/games/wordle/index.html");
  await page.act("click 'Continue'");
  await page.act("click 'Play'");
  await page.act("click cross sign on top right of 'How To Play' card");
  const word = "WORDS";
  for (const letter of word) {
    await page.act(`press ${letter}`);
  }
  await page.act("press enter");
  await stagehand.close();
}

(async () => {
  await example();
})();
