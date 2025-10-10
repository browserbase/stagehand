import { EvalFunction } from "../types/evals";

export const scroll_75: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );
    await v3.act("Scroll 75% down the page");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Get the current scroll position and total scroll height
    const scrollInfo = await page.evaluate(() => {
      return {
        scrollTop: window.scrollY + window.innerHeight * 0.75,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });

    const threeQuartersScroll = scrollInfo.scrollHeight * 0.75;
    const threeQuartersReached =
      Math.abs(scrollInfo.scrollTop - threeQuartersScroll) <= 200;
    const evaluationResult = threeQuartersReached
      ? {
          _success: true,
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        }
      : {
          _success: false,
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
          message: `Scroll position (${scrollInfo.scrollTop}px) is not three quarters down the page (${threeQuartersScroll}px).`,
        };

    return evaluationResult;
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await v3.close();
  }
};
