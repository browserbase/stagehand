import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "heal_scroll_50" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/");

      await stagehand.act({
        description: "the element to scroll on",
        selector: "/html/body/div/div/button",
        arguments: ["50%"],
        method: "scrollTo",
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const scrollInfo = await page.evaluate(() => ({
        scrollTop: window.scrollY + window.innerHeight / 2,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      const halfwayScroll = scrollInfo.scrollHeight / 2;
      const halfwayReached = Math.abs(scrollInfo.scrollTop - halfwayScroll) <= 200;

      return {
        _success: halfwayReached,
        ...(halfwayReached
          ? {}
          : {
              message: `Scroll position (${scrollInfo.scrollTop}px) is not halfway down the page (${halfwayScroll}px).`,
            }),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);
