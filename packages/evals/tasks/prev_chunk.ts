import { EvalFunction } from "../types/evals";

export const prev_chunk: EvalFunction = async ({
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
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { initialScrollTop, chunkHeight } = await page.evaluate(() => {
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
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await v3.act("scroll up one chunk");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const finalScrollTop = await page.evaluate(() => window.scrollY);

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
    await v3.close();
  }
};
