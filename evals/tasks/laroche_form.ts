import { EvalFunction } from "@/types/evals";

export const laroche_form: EvalFunction = async ({ stagehand, logger }) => {
  try {
    await stagehand.page.goto(
      "https://www.laroche-posay.us/offers/anthelios-melt-in-milk-sunscreen-sample.html",
    );

    await stagehand.page.act({ action: "close the privacy policy popup" });
    await stagehand.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});

    await stagehand.page.act({ action: "fill the last name field" });
    await stagehand.page.act({ action: "fill address 1 field" });
    await stagehand.page.act({ action: "select a state" });
    await stagehand.page.act({ action: "select a skin type" });

    return {
      _success: true,
      logs: logger.getLogs(),
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
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
