import { EvalFunction } from "../types/evals";

export const next_chunk: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.apartments.com/san-francisco-ca/", {
      waitUntil: "domcontentloaded",
    });
    await v3.act("click on the all filters button");

    const { initialScrollTop, chunkHeight } = await page.evaluate(() => {
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
    });

    await v3.act("scroll down one chunk on the filters modal");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const newScrollTop = await page.evaluate(() => {
      const container = document.querySelector(
        "#advancedFilters > div",
      ) as HTMLElement;
      return container?.scrollTop ?? 0;
    });

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
