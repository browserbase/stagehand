import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const nextChunk: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.apartments.com/san-francisco-ca/");
  await stagehand.page.act({
    action: "click on the all filters button",
    slowDomBasedAct: false,
  });

  const { initialScrollTop, chunkHeight } = await stagehand.page.evaluate(
    () => {
      const container = document.querySelector(
        "#advancedFilters > div",
      ) as HTMLElement;
      if (!container) {
        console.warn(
          "Could not find #advancedFilters > div. Returning 0 for measurements.",
        );
        return { initialScrollTop: 0, chunkHeight: 0 };
      }
      return {
        initialScrollTop: container.scrollTop,
        chunkHeight: container.getBoundingClientRect().height,
      };
    },
  );

  await stagehand.page.act({
    action: "scroll down one chunk on the filters modal",
    slowDomBasedAct: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const newScrollTop = await stagehand.page.evaluate(() => {
    const container = document.querySelector(
      "#advancedFilters > div",
    ) as HTMLElement;
    return container?.scrollTop ?? 0;
  });

  await stagehand.close();

  const actualDiff = newScrollTop - initialScrollTop;
  const threshold = 20; // allowable difference in px
  const scrolledOneChunk = Math.abs(actualDiff - chunkHeight) <= threshold;

  const evaluationResult = scrolledOneChunk
    ? {
        _success: true,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
        message: `Successfully scrolled ~one chunk: expected ~${chunkHeight}, got ${actualDiff}`,
      }
    : {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
        message: `Scroll difference expected ~${chunkHeight} but only scrolled ${actualDiff}.`,
      };

  return evaluationResult;
};
