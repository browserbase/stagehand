/**
 * This file is meant to be used as a scratchpad for developing new evals.
 * To create a Stagehand project with best practices and configuration, run:
 *
 * npx create-browser-app@latest my-browser-app
 */
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */
  const page = stagehand.page;
  await page.goto("https://aigrant.com/");
  const result = await page.extract({
    instruction: "extract the names and titles of the advisors and speakers",
    schema: z.object({
      people: z.array(
        z.object({
          name: z.string(),
          title: z.string(),
        }),
      ),
    }),
  });

  console.log(result);

  await page.act({
    action: "click on the name of the 5th person that was extracted",
    iframes: true,
  });
}

(async () => {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    useAPI: false,
    verbose: 2,
  });
  await stagehand.init();
  await example(stagehand);
  await stagehand.close();
})();
