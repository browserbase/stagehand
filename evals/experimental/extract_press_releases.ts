import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { z } from "zod";

export const extract_press_releases: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.landerfornyc.com/news");

    const result = await stagehand.extract({
      instruction:
        "extract a list of press releases on this page, with the title and publish date",
      schema: z.object({
        items: z.array(
          z.object({
            title: z.string(),
            publishedOn: z.string(),
          }),
        ),
      }),
    });

    await stagehand.close();
    const items = result.items;
    const expectedLength = 28;
    const expectedFirstItem = {
      title: "UAW Region 9A Endorses Brad Lander for Mayor",
      publishedOn: "Dec 4, 2024",
    };
    const expectedLastItem = {
      title: "An Unassuming Liberal Makes a Rapid Ascent to Power Broker",
      publishedOn: "Jan 23, 2014",
    };

    if (items.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of items extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: items.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of items extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const firstItemMatches =
      items[0].title === expectedFirstItem.title &&
      items[0].publishedOn === expectedFirstItem.publishedOn;
    const lastItemMatches =
      items[items.length - 1].title === expectedLastItem.title &&
      items[items.length - 1].publishedOn === expectedLastItem.publishedOn;

    return {
      _success: firstItemMatches && lastItemMatches,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `Error in extract_press_releases function`,
      level: 0,
      auxiliary: {
        error: {
          value: error.message || JSON.stringify(error),
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
      error: "An error occurred during extraction",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.context.close();
  }
};
