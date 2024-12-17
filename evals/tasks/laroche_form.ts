import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";

export const laroche_form: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto(
      "https://www.laroche-posay.us/offers/anthelios-melt-in-milk-sunscreen-sample.html",
    );

    await stagehand.act({ action: "close the privacy policy popup" });
    await stagehand.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});

    await stagehand.act({ action: "fill the last name field" });
    await stagehand.act({ action: "fill address 1 field" });
    await stagehand.act({ action: "select a state" });
    await stagehand.act({ action: "select a skin type" });

    return {
      _success: true,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: "error in LarocheForm function",
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
      error: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
