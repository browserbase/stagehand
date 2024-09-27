import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const nonsense_action = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== 'false' });
  await stagehand.init();
  // TODO: fix this eval
  try {
    await Promise.race([
      stagehand.page.goto("https://www.costar.com/"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 30000))
    ]);
    await stagehand.waitForSettledDom();

    const result = await stagehand.act({ action: "click on the first banana" });
    console.log("result", result);

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

  } catch (error) {
    console.error(`Error in costar function: ${error.message}`);
    return { title: null };
  } finally {
    await stagehand.context.close();
  }
};

async function main() {
  const [nonsenseResult] = await Promise.all([
    nonsense_action(),
  ]);
  
  console.log("Nonsense result:", nonsenseResult);
}

main().catch(console.error);