/**
 * This file is meant to be used as a scratchpad for trying out actionable observe.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "@/dist";
import stagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand(stagehandConfig);
  await stagehand.init();
  await stagehand.page.goto("https://www.apartments.com/san-francisco-ca/");

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations1 = await stagehand.page.observe({
    instruction: "find the 'all filters' button",
  });
  await stagehand.page.act(observations1[0]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations2 = await stagehand.page.observe({
    instruction: "find the '1+' button in the 'beds' section",
  });
  await stagehand.page.act(observations2[0]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations3 = await stagehand.page.observe({
    instruction: "find the 'apartments' button in the 'home type' section",
  });
  await stagehand.page.act(observations3[0]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations4 = await stagehand.page.observe({
    instruction: "find the pet policy dropdown to click on.",
  });
  await stagehand.page.act(observations4[0]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations5 = await stagehand.page.observe({
    instruction: "find the 'Dog Friendly' option to click on",
  });
  await stagehand.page.act(observations5[0]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const observations6 = await stagehand.page.observe({
    instruction: "find the 'see results' section",
  });
  await stagehand.page.act(observations6[0]);

  const currentUrl = await stagehand.page.url();
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
