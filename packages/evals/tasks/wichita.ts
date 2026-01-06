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
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/wichita/",
    );

    await v3.act('Click on "Show Closed/Awarded/Cancelled bids"');

    const result = await v3.extract(
      "Extract the total number of bids that the search produced.",
      z.object({
        total_results: z.number(),
      }),
    );

    const { total_results } = result;

    const expectedNumber = 430;

    if (total_results !== expectedNumber) {
      logger.error({
        message: "Total number of results does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedNumber.toString(),
            type: "integer",
          },
          actual: {
            value: total_results.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Total number of results does not match expected",
        total_results,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    return {
      _success: true,
      total_results,
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
