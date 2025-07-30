import { EvalFunction } from "@/types/evals";

export const bidnet: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://www.bidnetdirect.com/");

    await stagehand.page.act({
      action: 'Click on the "Construction" keyword',
    });

    const expectedUrl =
      "https://www.bidnetdirect.com/public/solicitations/open?keywords=Construction";
    const currentUrl = stagehand.page.url();

    return {
      _success: currentUrl.startsWith(expectedUrl),
      currentUrl,
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
