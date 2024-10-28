import { Stagehand } from "../lib";
import { z } from "zod";
import { EvalLogger } from "./utils";

// eval failing
const homedepot = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
  });

  await stagehand.init();

  try {
    await stagehand.page.goto("https://www.homedepot.com/");

    await stagehand.act({ action: "search for gas grills" });

    await stagehand.act({ action: "click on the first gas grill" });

    await stagehand.act({ action: "click on the Product Details" });

    await stagehand.act({ action: "find the Primary Burner BTU" });

    const productSpecs = await stagehand.extract({
      instruction: "Extract the Primary Burner BTU of the product",
      schema: z.object({
        productSpecs: z
          .array(
            z.object({
              burnerBTU: z.string().describe("Primary Burner BTU"),
            }),
          )
          .describe("Gas grill Primary Burner BTU"),
      }),
      modelName: "gpt-4o-2024-08-06",
    });
    console.log("The gas grill primary burner BTU is:", productSpecs);

    if (
      !productSpecs ||
      !productSpecs.productSpecs ||
      productSpecs.productSpecs.length === 0
    ) {
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

const vanta = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env: "LOCAL",
    headless: process.env.HEADLESS !== "false",
    logger: (message: any) => {
      logger.log(message);
    },
    verbose: 2,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.observe({
    instruction: "find the text for the request demo button",
  });

  console.log("Observations:", observations);

  if (observations.length === 0) {
    await stagehand.context.close();
    return {
      _success: false,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }

  const observationResult = await stagehand.page
    .locator(observations[0].selector)
    .first()
    .innerHTML();

  const expectedLocator = `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`;

  const expectedResult = await stagehand.page
    .locator(expectedLocator)
    .first()
    .innerHTML();

  await stagehand.context.close();

  return {
    _success: observationResult == expectedResult,
    expected: expectedResult,
    actual: observationResult,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

async function main() {
  // const homedepotResult = await homedepot();
  const vantaResult = await vanta();

  // console.log("Result:", homedepotResult);
  console.log("Result:", vantaResult);
}

main().catch(console.error);
