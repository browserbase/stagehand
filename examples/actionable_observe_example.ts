/**
 * This example shows how to use actionable observe()
 *
 * You can use observe to get a cache-able Playwright action as JSON, then pass that JSON to act() to perform the action.
 *
 * This is useful for:
 * - Previewing actions before running them
 * - Saving actions to a file and replaying them later
 * - Hiding sensitive information from LLMs
 *
 * For more on caching, see: https://docs.stagehand.dev/examples/caching
 * Also check out the form_filling_sensible.ts example for a more complex example of using observe() to fill out a form.
 */

import { ObserveResult, Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";

async function example() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();
  const page = stagehand.page;

  await page.goto("https://www.apartments.com/san-francisco-ca/");

  let observation: ObserveResult;

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the 'all filters' button",
  });
  await page.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the '1+' button in the 'beds' section",
  });
  await page.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the 'apartments' button in the 'home type' section",
  });
  await page.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the pet policy dropdown to click on.",
  });
  await page.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the 'Dog Friendly' option to click on",
  });
  await page.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await page.observe({
    instruction: "find the 'see results' section",
  });
  await page.act(observation);

  const currentUrl = page.url();
  await stagehand.close();
  if (
    currentUrl.includes(
      "https://www.apartments.com/apartments/san-francisco-ca/min-1-bedrooms-pet-friendly-dog/",
    )
  ) {
    console.log("✅ Success! we made it to the correct page");
  } else {
    console.log(
      "❌ Whoops, looks like we didn't make it to the correct page. " +
        "\nThanks for testing out this new Stagehand feature!" +
        "\nReach us on Slack if you have any feedback/questions/suggestions!",
    );
  }
}

(async () => {
  await example();
})();
