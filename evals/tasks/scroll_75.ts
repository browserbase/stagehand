import { Stagehand } from "@/dist";
import { EvalFunction } from "@/types/evals";

export const scroll_75: EvalFunction = async ({
  logger,
  stagehandConfig,
  debugUrl,
  sessionUrl,
}) => {
  const stagehand = new Stagehand({
    ...stagehandConfig,
    domSettleTimeoutMs: 3000,
  });
  await stagehand.init();

  await stagehand.page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
  );
  await stagehand.page.act({
    action: "Scroll 75% down the page",
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Get the current scroll position and total scroll height
  const scrollInfo = await stagehand.page.evaluate(() => {
    return {
      scrollTop: window.scrollY + window.innerHeight * 0.75,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  await stagehand.close();

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
};
