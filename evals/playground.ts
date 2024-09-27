import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const nonsense_action = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1, debugDom: true, headless: true });
  await stagehand.init();
  
  try {
    await stagehand.page.goto("https://www.homedepot.com/");
    await stagehand.waitForSettledDom();

    const result = await stagehand.act({ action: "click on the first banana" });
    console.log("result", result);

    // Assert the output
    const expectedResult = {
      success: false,
      message: 'Action not found on the current page after checking all chunks.',
      action: 'click on the first banana'
    };

    const isResultCorrect = JSON.stringify(result) === JSON.stringify(expectedResult);
    
    return isResultCorrect;

  } catch (error) {
    console.error(`Error in nonsense_action function: ${error.message}`);
    return false;
  } finally {
    await stagehand.context.close();
  }
};

async function main() {
  const nonsenseResult = await nonsense_action();
  
  console.log("Nonsense result:", nonsenseResult);
}

main().catch(console.error);