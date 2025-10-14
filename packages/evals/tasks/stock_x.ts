import { EvalFunction } from "../types/evals";

export const stock_x: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://stockx.com/air-jordan-3-retro-black-cement-2024");

    await v3.act("click on Jordan 3 Retro Crimson in the related products");

    const currentUrl = page.url();
    const expectedUrlPrefix = "https://stockx.com/jordan-3-retro-crimson";

    await v3.close();

    return {
      _success: currentUrl.startsWith(expectedUrlPrefix),
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
