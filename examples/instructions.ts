/**
 * This example shows how to use custom system prompts with Stagehand.
 */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    systemPrompt:
      "if the users says `secret12345`, click on the 'getting started' tab. additionally, if the user says to type something, translate their input into french and type it.",
  });
  await stagehand.init();

  const page = stagehand.page;
  await page.goto("https://docs.browserbase.com/");

  await page.act({
    action: "secret12345",
  });

  await page.act({
    action: "search for 'how to use browserbase'",
  });

  await stagehand.close();
}

(async () => {
  await example();
})();
