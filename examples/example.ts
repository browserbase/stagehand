import StagehandConfig from "./stagehand.config.js";
import { Stagehand } from "../lib/index.js";
import { z } from "zod";

async function main() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();
  const page = stagehand.page;

  //   You can use the `page` instance to write any Playwright code
  //   For more info: https://playwright.dev/docs/pom
  await page.goto("https://www.google.com");

  //   In the event that your Playwright code fails, you can use the `act` method to
  //   let Stagehand AI take over and complete the action.
  try {
    throw new Error("Comment me out to run the base Playwright code!");
    await page.locator('textarea[name="q"]').click();
    await page.locator('textarea[name="q"]').fill("Stagehand GitHub");
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
  } catch {
    await stagehand.act({
      action: "type in 'Stagehand GitHub' in the search bar and hit enter",
    });
  }

  const githubResult = await stagehand.extract({
    instruction: "find the github link in the search results",
    // Zod is a schema validation library for TypeScript.
    // For more information on Zod, visit: https://zod.dev/
    schema: z.object({
      title: z.string(),
      link: z.string(),
      description: z.string(),
    }),
  });
  console.log(
    `The top result is ${githubResult.title}: ${githubResult.link}. ${githubResult.description}`,
  );

  //   Click the first link in the search results to to the GitHub page
  try {
    //   Stagehand's `observe` method returns a list of selectors that can be used to interact with the page
    //   NOTE: you could also just do stagehand.act() to click the top result, but this is a good example of how to use observe
    const observeResult = await stagehand.observe({
      instruction: "Find the link to click to click the top result",
    });
    console.log("We can click:", observeResult);

    // Click the selector at the top of the list
    await page.locator(`${observeResult[0].selector}`).click();
    await page.waitForLoadState("networkidle");
  } catch {
    await stagehand.act({
      action: "click the first link in the search results",
    });
  }
  await stagehand.close();
}

(async () => {
  await main().catch(console.error);
})();
