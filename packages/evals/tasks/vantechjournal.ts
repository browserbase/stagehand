import { EvalFunction } from "../types/evals";

export const vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://vantechjournal.com");

    await v3.act("click on page 'recommendations'");

    const expectedUrl = "https://vantechjournal.com/recommendations";
    const currentUrl = page.url();

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
    await v3.close();
  }
};
