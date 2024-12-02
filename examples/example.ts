import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    enableCaching: false,
  });

  await stagehand.init({
    modelName: "gemini-1.5-flash",
    modelClientOptions: {
      apiKey: process.env.GEMINI_API_KEY,
    },
  });
  await stagehand.page.goto("https://github.com/browserbase/stagehand");
  await stagehand.act({ action: "click on the contributors" });
  const contributor = await stagehand.extract({
    instruction: "extract the top contributor",
    schema: z.object({
      username: z.string(),
      url: z.string(),
    }),
  });
  console.log(`Our favorite contributor is ${contributor.username}`);
}

(async () => {
  await example();
})();
