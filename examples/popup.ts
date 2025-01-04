/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "../lib";
import StagehandConfig from "./stagehand.config";

async function example() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();

  const page = await stagehand.page;

  page.on("popup", async (newPage) => {
    // await Promise.all([page.goto(newPage.url()), newPage.close()]);
    // or
    newPage.act({
      action: "type 'test@gmail.com' in the email field",
    });
  });

  await page.goto("https://nextdoor.com/login/");

  await page.act({
    action: "click on the log in with google button",
  });

  await stagehand.close();
}

(async () => {
  await example();
})();
