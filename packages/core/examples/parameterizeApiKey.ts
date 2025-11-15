import { Stagehand } from "../lib/v3";
import { z } from "zod";

/**
 * This example shows how to parameterize the API key for the LLM provider.
 *
 * In order to best demonstrate, unset the OPENAI_API_KEY environment variable and
 * set the USE_OPENAI_API_KEY environment variable to your OpenAI API key.
 *
 * export USE_OPENAI_API_KEY=$OPENAI_API_KEY
 * unset OPENAI_API_KEY
 */

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    model: {
      modelName: "gpt-4o",
      apiKey: process.env.USE_OPENAI_API_KEY,
    },
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
