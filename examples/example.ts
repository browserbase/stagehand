/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "@browserbasehq/stagehand";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.page;
  await page.goto("https://aca-prod.accela.com/BALTIMORE/welcome.aspx");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // await page.act("type 'testusername' into the username field");
  await page.observe("do nothing");

  // https://www.ycombinator.com/careers?ashby_jid=00c6950f-341f-4924-a456-ea32c9d5601d
  // https://aca-prod.accela.com/BALTIMORE/welcome.aspx
  // https://tucowsdomains.com/abuse-form/phishing/
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    logInferenceToFile: false,
  });
  await stagehand.init();
  await example(stagehand);
})();
