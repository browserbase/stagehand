import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const prevChunk: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;
  await stagehand.page.goto("https://aigrant.com/");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const { initialScrollTop, chunkHeight } = await stagehand.page.evaluate(
    () => {
      const halfPage = document.body.scrollHeight / 2;

      window.scrollTo({
        top: halfPage,
        left: 0,
        behavior: "instant",
      });

      const chunk = window.innerHeight;

      return {
        initialScrollTop: window.scrollY,
        chunkHeight: chunk,
      };
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await stagehand.page.act({
    action: "scroll up one chunk",
    slowDomBasedAct: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const finalScrollTop = await stagehand.page.evaluate(() => window.scrollY);

  await stagehand.close();

  const actualDiff = initialScrollTop - finalScrollTop;
  const threshold = 20; // px tolerance
  const scrolledOneChunk = Math.abs(actualDiff - chunkHeight) <= threshold;

  const evaluationResult = scrolledOneChunk
    ? {
        _success: true,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
        message: `Successfully scrolled ~one chunk UP: expected ~${chunkHeight}, got ${actualDiff}.`,
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
