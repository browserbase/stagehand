import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { z } from "zod";

export const extract_regulations: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.jsc.gov.jo/Links2/en/Regulations");

  const result = await stagehand.extract({
    instruction: "Extract the list of regulations with their descriptions and issue dates",
    schema: z.object({
      regulations: z.array(
        z.object({
          description: z.string(),
          issue_date: z.string(),
        })
      ),
    }),
    modelName,
  });

  await stagehand.close();

  const regulations = result.regulations;
  const expectedLength = 4;

  const expectedFirstItem = {
    description: "The Regulation of Investors Protection Fund in Securities No. (47) for the Year 2018 Amended Pursuant to Regulation No. (24) for the Year 2019",
    issue_date: "2019",
  };

  const expectedLastItem = {
    description: "Islamic Finance sukuk conrract regulation",
    issue_date: "2014",
  };

  if (regulations.length !== expectedLength) {
    logger.error({
      message: "Incorrect number of regulations extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedLength.toString(),
          type: "integer",
        },
        actual: {
          value: regulations.length.toString(),
          type: "integer",
        },
      },
    });
    return {
      _success: false,
      error: "Incorrect number of regulations extracted",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }
  const firstItemMatches =
    regulations[0].description === expectedFirstItem.description &&
    regulations[0].issue_date === expectedFirstItem.issue_date;

  if (!firstItemMatches) {
    logger.error({
      message: "First regulation extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedFirstItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(regulations[0]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "First regulation extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  const lastItemMatches =
    regulations[regulations.length - 1].description === expectedLastItem.description &&
    regulations[regulations.length - 1].issue_date === expectedLastItem.issue_date;

  if (!lastItemMatches) {
    logger.error({
      message: "Last regulation extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedLastItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(regulations[regulations.length - 1]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "Last regulation extracted does not match expected",
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