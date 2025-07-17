import { Stagehand } from "@browserbasehq/stagehand";
import { EvalFunction } from "@/types/evals";

export const prevChunk: EvalFunction = async ({
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
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );
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
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const finalScrollTop = await stagehand.page.evaluate(() => window.scrollY);

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
