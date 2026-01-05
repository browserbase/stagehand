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

import { Action, Stagehand } from "../lib/v3";

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  await page.goto("https://www.apartments.com/san-francisco-ca/");

  let observation: Action;

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe("find the 'all filters' button");
  await stagehand.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe(
    "find the '1+' button in the 'beds' section",
  );
  await stagehand.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe(
    "find the 'apartments' button in the 'home type' section",
  );
  await stagehand.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe(
    "find the pet policy dropdown to click on.",
  );
  await stagehand.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe(
    "find the 'Dog Friendly' option to click on",
  );
  await stagehand.act(observation);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  [observation] = await stagehand.observe("find the 'see results' section");
  await stagehand.act(observation);

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
        "\nReach us on Discord if you have any feedback/questions/suggestions!",
    );
  }
}

(async () => {
  await example();
})();
