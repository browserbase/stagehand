import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { normalizeString } from "../utils";
import { z } from "zod";

export const extract_capacitor_info: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(
    "https://www.tti.com/content/ttiinc/en/apps/part-detail.html?partsNumber=C320C104K5R5TA&mfgShortname=KEM&productId=6335148",
  );

  const result = await stagehand.extract({
    instruction:
      "Extract the TTI Part Number, Product Category, and minimum operating temperature of the capacitor.",
    schema: z.object({
      tti_part_number: z.string(),
      product_category: z.string(),
      min_operating_temp: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { tti_part_number, product_category, min_operating_temp } = result;

  const expected = {
    tti_part_number: "C320C104K5R5TA",
    product_category: "Multilayer Ceramic Capacitors MLCC - Leaded",
    min_operating_temp: "- 55 C",
  };

  if (
    normalizeString(tti_part_number) !==
    normalizeString(expected.tti_part_number)
  ) {
    logger.error({
      message: "TTI Part Number extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.tti_part_number),
          type: "string",
        },
        actual: {
          value: normalizeString(tti_part_number),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "TTI Part Number extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (
    normalizeString(product_category) !==
    normalizeString(expected.product_category)
  ) {
    logger.error({
      message: "Product Category extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.product_category),
          type: "string",
        },
        actual: {
          value: normalizeString(product_category),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Product Category extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (
    normalizeString(min_operating_temp) !==
    normalizeString(expected.min_operating_temp)
  ) {
    logger.error({
      message:
        "Minimum operating temperature extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.min_operating_temp),
          type: "string",
        },
        actual: {
          value: normalizeString(min_operating_temp),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Minimum operating temperature extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
    debugUrl,
    sessionUrl,
  };
};
