import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_rockauto: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/rockauto/",
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await stagehand.page.extract({
      instruction:
        "Extract the part number of all the coolant and antifreeze products in the 'economy' category. " +
        "Do not include the manufacturer name. Do not include products from the premium category.",
      schema: z.object({
        coolant_products: z.array(
          z.object({
            part_number: z.string(),
          }),
        ),
      }),
    });

    const coolantProducts = result.coolant_products;
    const expectedPartNumbers = [
      "GREEN5050GAL",
      "719009",
      "AF3300",
      "AF3100",
      "MV5050GAL",
    ];
    const expectedLength = expectedPartNumbers.length;

    if (coolantProducts.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of coolant products extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: coolantProducts.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of coolant products extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const missingParts = expectedPartNumbers.filter(
      (expectedPart) =>
        !coolantProducts.some((p) => p.part_number === expectedPart),
    );

    if (missingParts.length > 0) {
      logger.error({
        message: "Missing expected part number(s)",
        level: 0,
        auxiliary: {
          missingParts: {
            value: JSON.stringify(missingParts),
            type: "object",
          },
          actualExtracted: {
            value: JSON.stringify(coolantProducts),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: `One or more expected part numbers were not found: ${missingParts.join(", ")}`,
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
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
