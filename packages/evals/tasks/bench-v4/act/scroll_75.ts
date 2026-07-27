import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "scroll_75" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
      );
      await stagehand.act("Scroll 75% down the page");

      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Get the current scroll position and total scroll height
      const scrollInfo = await page.evaluate(() => {
        return {
          scrollTop: window.scrollY + window.innerHeight * 0.75,
          scrollHeight: document.documentElement.scrollHeight,
        };
      });

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
