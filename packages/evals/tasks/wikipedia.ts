import { EvalFunction } from "../types/evals";

export const wikipedia: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(`https://en.wikipedia.org/wiki/Baseball`);
    await v3.act('click the "hit and run" link in this article', {
      timeout: 360_000,
    });

    const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
    const currentUrl = page.url();

    return {
      _success: currentUrl === url,
      expected: url,
      actual: currentUrl,
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
