import { Stagehand } from "../lib/v3";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  await page.goto("https://www.nytimes.com/games/wordle/index.html");
  await stagehand.act("click 'Continue'");
  await stagehand.act("click 'Play'");
  await stagehand.act("click cross sign on top right of 'How To Play' card");
  const word = "WORDS";
  for (const letter of word) {
    await stagehand.act(`press ${letter}`);
  }
  await stagehand.act("press enter");
  await stagehand.close();
}

(async () => {
  await example();
})();
