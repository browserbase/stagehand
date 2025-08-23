/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */
import { V3 } from "../lib/v3/v3";
// import { chromium } from "playwright";
import fs from "fs";
// import dotenv from "dotenv";
// dotenv.config();

async function example(v3: V3) {
  /**
   * Add your code here!
   */

  const context = v3.context();
  // const page = context.pages()[0];
  const page = context.pages()[0];
  await page.goto("https://www.apartments.com/san-francisco-ca/", {
    waitUntil: "domcontentloaded",
  });
  console.log("content loaded");
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const fullFrameTree = page.getFullFrameTree();
  fs.writeFileSync(
    "fullFrameTree.json",
    JSON.stringify(fullFrameTree, null, 2),
  );
  console.log("attempting to load fullFrameTree");
  console.log(`full frame tree: ${fullFrameTree}`);

  const ctx = v3.context() as unknown as {
    // narrow types for debugging without 'any'
    pagesByTarget?: Map<string, unknown>;
    mainFrameToTarget?: Map<string, string>;
    typeByTarget?: Map<string, string>;
  };
  if (ctx.mainFrameToTarget && ctx.typeByTarget) {
    const counts = { pages: 0, iframes: 0, other: 0 };
    for (const [, tid] of ctx.mainFrameToTarget.entries()) {
      const typ = ctx.typeByTarget.get(tid) ?? "other";
      if (typ === "page") counts.pages++;
      else if (typ === "iframe") counts.iframes++;
      else counts.other++;
    }
    console.log("[V3] targets seen:", counts);
  }

  // const wsEndpoint = v3.connectURL();
  // const pwBrowser = await chromium.connectOverCDP(wsEndpoint);
  // const defaultContext = pwBrowser.contexts()[0];
  // const page = defaultContext?.pages()[0];
  // await page.goto(
  //   "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
  // );
  //
  // const [page2] = await Promise.all([
  //   defaultContext.waitForEvent("page"), // resolves with the new Page object
  //   page.locator("xpath=/html/body/button").click(), // action that triggers new tab
  // ]);
  // await v3.act({ instruction: "yeeeeeeeee", page: page2 });
}

(async () => {
  const v3 = new V3({
    env: "LOCAL", // or "BROWSERBASE"
    // apiKey: process.env.BROWSERBASE_API_KEY, // needed if using Browserbase
    // projectId: process.env.BROWSERBASE_PROJECT_ID, // needed if using Browserbase
    headless: false,
  });
  await v3.init();
  await example(v3);
  // await v3.close();
})();
