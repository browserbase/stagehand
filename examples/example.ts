/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */

import { Stagehand } from "@/lib/index";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    localDebugPort: 9222,
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.act(
    `type 'if you're seeing this tweet, get excited -- i'm using stagehand on arc!'`,
  );
  await page.act("click the post button");
  await stagehand.close();
}

(async () => {
  await example();
})();
