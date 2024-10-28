import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
  });

  await stagehand.init({ modelName: "claude-3-5-sonnet-20241022" });
  await stagehand.page.goto("https://github.com/vercel/next.js");
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
