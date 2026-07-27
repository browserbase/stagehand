import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "next_chunk" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://www.apartments.com/san-francisco-ca/", {
        waitUntil: "domcontentloaded",
      });
      await stagehand.act("click on the all filters button");

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

      await stagehand.act("scroll down one chunk on the filters modal");

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
      await stagehand.close();
    }
  },
);
