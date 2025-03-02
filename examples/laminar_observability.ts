// This example demonstrates how to use Laminar to observe a Stagehand session.
//
// Prerequisites:
// 1. Sign up on Laminar with a free account and get a project API key.
//    - You can alternatively spin up Laminar locally, see https://github.com/lmnr-ai/lmnr
// 2. Run `export LMNR_PROJECT_API_KEY=<your-api-key>`
// 3. Expose your OPENAI_API_KEY to the environment.
// 4. IMPORTANT:
//    - For automatic instrumentation to work, make sure you are importing
//      Stagehand from `@browserbase/stagehand`.
//    - That is, you need to first `npm install @browserbasehq/stagehand`

import { Laminar } from "@lmnr-ai/lmnr";

// It is important to initialize Laminar before importing Stagehand.
// In real applications, this will probably happen in a different file, at the entry
// point of your application.
// For example, in Next.js, you would initialize laminar in
// [instrumentation.ts](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
Laminar.initialize({
  projectApiKey: process.env.LMNR_PROJECT_API_KEY,
});

// Comment out the following line (see point 4 above).
import { Stagehand } from "@/dist";
// And uncomment the following line (see point 4 above).
// import { Stagehand } from "@browserbasehq/stagehand";

import { z } from "zod";

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
