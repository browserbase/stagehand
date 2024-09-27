import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

// eval failing
const homedepot = async () => {
  // this one is HARD since the page is slow to load
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== "false" });
  await stagehand.init();
  
  try {
    await stagehand.page.goto("https://www.homedepot.com/");
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "search for gas grills" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the best selling gas grill" });
    await stagehand.waitForSettledDom();
    
    await stagehand.act({ action: "click on the specifications" });
    await stagehand.waitForSettledDom();

    const productSpecs = await stagehand.extract({
      instruction: "Extract the product specs of the grill",
      schema: z.object({
        productSpecs: z.array(z.object({
          burnerBTU: z.string().describe("The BTU of the burner"),
        })).describe("The product specs")
      }),
      modelName: "gpt-4o-2024-08-06"
    });
    console.log("The product specs are:", productSpecs);

    if (!productSpecs || !productSpecs.productSpecs || productSpecs.productSpecs.length === 0) {
      return false;
    }

    return true;

  } catch (error) {
    console.error(`Error in nonsense_action function: ${error.message}`);
    return false;
  } finally {
    await stagehand.context.close();
  }
};

async function main() {
  const homedepotResult = await homedepot();
  
  console.log("Homedepot result:", homedepotResult);
}

main().catch(console.error);