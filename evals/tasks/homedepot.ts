import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const homedepot: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.homedepot.com/");
    await stagehand.page.act("enter 'gas grills' in the search bar");
    await stagehand.page.act("press enter");
    await stagehand.page.act("click on the best selling gas grill");
    await stagehand.page.act("click on the Product Details");

    const productSpecs = await stagehand.page.extract({
      instruction: "Extract the Primary exact Burner BTU of the product",
      schema: z.object({
        productSpecs: z.object({
          burnerBTU: z.number().describe("Primary Burner BTU exact value"),
        }),
      }),
    });

    logger.log({
      message: `gas grill primary burner BTU`,
      level: 1,
      auxiliary: {
        productSpecs: {
          value: JSON.stringify(productSpecs),
          type: "object",
        },
      },
    });

    if (!productSpecs || !productSpecs.productSpecs) {
      return {
        _success: false,
        productSpecs,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const isLargerThan1000 = productSpecs.productSpecs.burnerBTU >= 10000;

    return {
      _success: isLargerThan1000,
      productSpecs,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in homedepot function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
