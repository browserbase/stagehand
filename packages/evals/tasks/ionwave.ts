import { EvalFunction } from "../types/evals";

export const ionwave: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/",
    );

    await v3.act('Click on "Closed Bids"');

    const expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/closed-bids.html";
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
