/**
 * This example shows how to use custom system prompts with Stagehand.
 */
import { Stagehand } from "../lib/v3";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    systemPrompt:
      "if the users says `secret12345`, click on the 'getting started' tab. additionally, if the user says to type something, translate their input into french and type it.",
  });
  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://docs.browserbase.com/");

  await stagehand.act("secret12345");

  await stagehand.act("search for 'how to use browserbase'");

  await stagehand.close();
}

(async () => {
  await example();
})();
