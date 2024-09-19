import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const zillow = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: true });
  await stagehand.init();

  await stagehand.page.goto("https://www.costar.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the first article" });
  
  await stagehand.waitForSettledDom();
  const articleTitle = await stagehand.extract({
    instruction: "extract the title of the article",
    schema: z.object({
      title: z.string().describe("the title of the article").nullable()
    }),
    modelName: "gpt-4o-2024-08-06"
  });

  console.log("articleTitle", articleTitle);

  // Check if the title is more than 5 characters
  const isTitleValid = articleTitle.title !== null && articleTitle.title.length > 5;

  await stagehand.context.close();

  return isTitleValid;
};

async function main() {
  const result = await zillow();
  console.log("Zillow task result:", result);
}

main().catch(console.error);