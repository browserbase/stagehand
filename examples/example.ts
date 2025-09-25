/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v3";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.page;
  await page.goto("https://docs.stagehand.dev");
  // tree parsing callback demo: remove all occurrences of "StaticText"

  await page.act({
    action: "click the quickstart button",
    treeParser: (tree: string) => tree.replace(/StaticText/g, ""),
  });

  await page.extract({
    instruction: "extract the webpage title",
    schema: z.object({
      title: z.string(),
    }),
    treeParser: (tree: string) => tree.replace(/StaticText/g, ""),
  });

  await page.observe({
    instruction: "find the button that leads to the 'act' page",
    treeParser: (tree: string) => tree.replace(/StaticText/g, ""),
  });
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    // check inference_summary directory
    // you should see no occurrences of the substring 'StaticText'
    logInferenceToFile: true,
  });
  await stagehand.init();
  await example(stagehand);
})();
