import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    modelName: "openai/gpt-4o",
  });

  await stagehand.init();
  await stagehand.page.goto("https://news.ycombinator.com");

  const { story } = await stagehand.page.extract({
    instruction: "extract the title of the top story on the page",
    schema: z.object({
      story: z.string().describe("the top story on the page"),
    }),
  });

  console.log("The top story is:", story);

  await stagehand.page.act("click the first story");

  await stagehand.close();
}

(async () => {
  await example();
})();
