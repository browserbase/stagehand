import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const homedepot: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.homedepot.com/");
    await v3.act("enter 'gas grills' in the search bar");
    await v3.act("press enter");
    await v3.act("click on the best selling gas grill");
    await v3.act("click on the Product Details");

    const productSpecs = await v3.extract(
      "Extract the Primary exact Burner BTU of the product",
      z.object({
        productSpecs: z.object({
          burnerBTU: z.number().describe("Primary Burner BTU exact value"),
        }),
      }),
    );

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
    await v3.close();
  }
};
