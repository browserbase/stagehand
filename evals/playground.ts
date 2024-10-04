import { Stagehand } from "../lib";
import { z } from "zod";

// eval failing
const homedepot = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1, debugDom: true, headless: process.env.HEADLESS !== "false" });

  await stagehand.init();
  
  try {

    await stagehand.page.goto("https://www.homedepot.com/");

    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "search for gas grills" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the first gas grill" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the Product Details" });
    await stagehand.waitForSettledDom();
    
    await stagehand.act({ action: "find the Primary Burner BTU" });
    await stagehand.waitForSettledDom();

    const productSpecs = await stagehand.extract({
      instruction: "Extract the Primary Burner BTU of the product",
      schema: z.object({
        productSpecs: z.array(z.object({
          burnerBTU: z.string().describe("Primary Burner BTU"),
        })).describe("Gas grill Primary Burner BTU")
      }),
      modelName: "gpt-4o-2024-08-06",
    });
    console.log("The gas grill primary burner BTU is:", productSpecs);

    if (!productSpecs || !productSpecs.productSpecs || productSpecs.productSpecs.length === 0) {
      return false;
    }

    return true;

  } catch (error) {
    console.error(`Error in homedepot function: ${error.message}`);
    return false;
  } finally {
    await stagehand.context.close();
  }
};


async function main() {
  const homedepotResult = await homedepot();

  console.log("Result:", homedepotResult);
}

main().catch(console.error);
