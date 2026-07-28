import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "next_chunk" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://www.apartments.com/san-francisco-ca/", {
        waitUntil: "domcontentloaded",
      });
      await stagehand.act("click on the all filters button");

      const { initialScrollTop, chunkHeight } = await page.evaluate(() => {
        const container = document.querySelector("#advancedFilters > div") as HTMLElement;
        if (!container) {
          throw new Error("Could not find the filters modal");
        }
        return {
          initialScrollTop: container.scrollTop,
          chunkHeight: container.getBoundingClientRect().height,
        };
      });

      await stagehand.act("scroll down one chunk on the filters modal");

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const newScrollTop = await page.evaluate(() => {
        const container = document.querySelector("#advancedFilters > div") as HTMLElement;
        if (!container) {
          throw new Error("The filters modal disappeared before validation");
        }
        return container.scrollTop;
      });

      const actualDiff = newScrollTop - initialScrollTop;
      const threshold = 20; // allowable difference in px
      const scrolledOneChunk = chunkHeight > 0 && Math.abs(actualDiff - chunkHeight) <= threshold;

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
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
