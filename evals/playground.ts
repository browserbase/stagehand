import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const costar = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: true, debugDom: true });
  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  await stagehand.page.goto("https://www.costar.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the first article" });

  await stagehand.act({ action: "find the footer of the page" });
  
  await stagehand.waitForSettledDom();
  const articleTitle = await stagehand.extract({
    instruction: "extract the title of the article",
    schema: z.object({
      title: z.string().describe("the title of the article").nullable(),
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
  const result = await costar();
  console.log("Costar task result:", result);
}

main().catch(console.error);