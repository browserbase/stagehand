import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";
import { z } from "zod";

export const sciquest: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(
    "https://bids.sciquest.com/apps/Router/PublicEvent?tab=PHX_NAV_SourcingAllOpps&CustomerOrg=StateOfUtah"
  );

  await stagehand.act({
    action: 'Click on the "Closed" tab',
  });

  const result = await stagehand.extract({
    instruction: "Extract the total number of results that the search produced. Not the number of results displayed on the page.",
    schema: z.object({
      total_results: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { total_results } = result;

  const expectedNumber = 12637;
  const extractedNumber = parseInt(total_results.replace(/[^\d]/g, ""), 10);

  const isWithinRange =
    extractedNumber >= expectedNumber - 1000 &&
    extractedNumber <= expectedNumber + 1000;

  if (!isWithinRange) {
    logger.error({
      message: "Total number of results is not within the expected range",
      level: 0,
      auxiliary: {
        expected: {
          value: `${expectedNumber} ± 1000`,
          type: "range",
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
};
