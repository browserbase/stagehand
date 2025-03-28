// This example demonstrates how to use Laminar to observe a Stagehand session.
//
// Prerequisites:
// 1. Sign up on Laminar with a free account and get a project API key.
//    - You can alternatively spin up Laminar locally, see https://github.com/lmnr-ai/lmnr
// 2. Run `export LMNR_PROJECT_API_KEY=<your-api-key>`
// 3. Expose your OPENAI_API_KEY to the environment.

import { Laminar } from "@lmnr-ai/lmnr";
import { Stagehand } from "@/dist";
import { z } from "zod";

Laminar.initialize({
  projectApiKey: process.env.LMNR_PROJECT_API_KEY,
  // In some JS bundlers, you may not need to pass instrumentModules; it may
  // be enough to initialize Laminar *before* importing Stagehand.
  instrumentModules: {
    stagehand: Stagehand,
  },
});

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "gpt-4o-mini",
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.goto("https://www.lmnr.ai/blog");

  const latestBlogPost = await page.extract({
    instruction: "Get the information about the latest blog post",
    schema: z.object({
      title: z.string(),
      date: z.string(),
    }),
  });
  console.log(latestBlogPost);

  await stagehand.close();

  // In one-off scripts like this, it is important to shut down Laminar to make
  // sure all spans and session data is flushed and sent to the server.
  await Laminar.shutdown();
}

(async () => {
  await example();
})();
