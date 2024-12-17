import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const expedia_search: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.expedia.com/flights");

    await stagehand.act({
      action:
        "find round-trip flights from San Francisco (SFO) to Toronto (YYZ) for Jan 1, 2025 (up to one to two weeks)",
    });

    await stagehand.act({ action: "Go to the first non-stop flight" });

    await stagehand.act({ action: "select the cheapest flight" });

    await stagehand.act({ action: "click on the first non-stop flight" });

    await stagehand.act({
      action: "Take me to the checkout page",
    });

    const url = stagehand.page.url();
    return {
      _success: url.startsWith("https://www.expedia.com/Checkout/"),
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `error in expedia function`,
      level: 0,
      auxiliary: {
        error: {
          value: JSON.stringify(error, null, 2),
          type: "object",
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
