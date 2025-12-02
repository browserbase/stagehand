import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const wichita: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.wichitafallstx.gov/Bids.aspx");

    await v3.act('Click on "Show Closed/Awarded/Cancelled bids"');

    const result = await v3.extract(
      "Extract the total number of bids that the search produced.",
      z.object({
        total_results: z.string(),
      }),
    );

    const { total_results } = result;

    const expectedNumber = 418;
    const extractedNumber = parseInt(total_results.replace(/[^\d]/g, ""), 10);

    const isWithinRange =
      extractedNumber >= expectedNumber - 10 &&
      extractedNumber <= expectedNumber + 10;

    if (!isWithinRange) {
      logger.error({
        message: "Total number of results is not within the expected range",
        level: 0,
        auxiliary: {
          expected: {
            value: `${expectedNumber} ± 10`,
            type: "string",
          },
          actual: {
            value: extractedNumber.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Total number of results is not within the expected range",
        extractedNumber,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    return {
      _success: true,
      extractedNumber,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
