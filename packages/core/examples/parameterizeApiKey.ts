import { Stagehand } from "../lib/v3/index.js";
import { z } from "zod";

/**
 * This example shows how to use a model string with Stagehand.
 *
 * When using env: "BROWSERBASE", the API key is automatically resolved
 * from environment variables, so you only need to specify the model name.
 */

async function example() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
    model: "openai/gpt-4o",
  });

  await stagehand.init();
  const page = stagehand.context.pages()[0];
  await page.goto("https://github.com/browserbase/stagehand");
  await stagehand.act("click on the contributors");
  const contributor = await stagehand.extract(
    "extract the top contributor",
    z.object({
      username: z.string(),
      url: z.string(),
    }),
  );
  console.log(`Our favorite contributor is ${contributor.username}`);
}

(async () => {
  await example();
})();
