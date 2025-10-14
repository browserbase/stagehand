import { EvalFunction } from "../types/evals";

export const bidnet: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.bidnetdirect.com/");

    await v3.act('Click on the "Construction" keyword');

    const expectedUrl =
      "https://www.bidnetdirect.com/public/solicitations/open?keywords=Construction";
    const currentUrl = page.url();

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
    await v3.close();
  }
};
