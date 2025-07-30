import { EvalFunction } from "@/types/evals";

export const heal_scroll_50: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );
    await stagehand.page.act({
      description: "the element to scroll on",
      selector: "/html/body/div/div/button",
      arguments: ["50%"],
      method: "scrollTo",
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Get the current scroll position and total scroll height
    const scrollInfo = await stagehand.page.evaluate(() => {
      return {
        scrollTop: window.scrollY + window.innerHeight / 2,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });

    const halfwayScroll = scrollInfo.scrollHeight / 2;
    const halfwayReached =
      Math.abs(scrollInfo.scrollTop - halfwayScroll) <= 200;
    const evaluationResult = halfwayReached
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
          message: `Scroll position (${scrollInfo.scrollTop}px) is not halfway down the page (${halfwayScroll}px).`,
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
    await stagehand.close();
  }
};
