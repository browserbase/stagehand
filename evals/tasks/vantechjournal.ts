import { EvalFunction } from "@/types/evals";

export const vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://vantechjournal.com");

    await stagehand.page.act({
      action: "click on page 'recommendations'",
    });

    const expectedUrl = "https://vantechjournal.com/recommendations";
    const currentUrl = stagehand.page.url();

    return {
      _success: currentUrl === expectedUrl,
      currentUrl,
      expectedUrl,
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
    await stagehand.close();
  }
};
