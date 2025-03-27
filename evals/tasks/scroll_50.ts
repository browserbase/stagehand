import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const scroll_50: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;
  await stagehand.page.goto("https://aigrant.com/");
  await stagehand.page.act({
    action: "Scroll 50% down the page",
    slowDomBasedAct: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Get the current scroll position and total scroll height
  const scrollInfo = await stagehand.page.evaluate(() => {
    return {
      scrollTop: window.scrollY + window.innerHeight / 2,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  await stagehand.close();

  const halfwayScroll = scrollInfo.scrollHeight / 2;
  const halfwayReached = Math.abs(scrollInfo.scrollTop - halfwayScroll) <= 200;
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
};
