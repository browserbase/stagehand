import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "heal_scroll_50" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/aigrant/");

      const { data: healed } = await stagehand.act({
        description: "the element to scroll on",
        selector: "/html/body/div/div/button",
        arguments: ["50%"],
        method: "scrollTo",
      });

      if (!healed.success) {
        return {
          _success: false,
          message: `self-heal did not scroll the page: ${healed.message}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const scrollInfo = await page.evaluate(() => {
        return {
          scrollTop: window.scrollY + window.innerHeight / 2,
          scrollHeight: document.documentElement.scrollHeight,
        };
      });

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
    }
  },
);
