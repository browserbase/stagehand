import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "heal_scroll_50" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/");

      // Self-healing act(Action) replay (V4_API_LOGS.md #1, restored by
      // stagehand#2427): same supplied action as the v3 twin — a
      // "scrollTo" with arguments ["50%"], exercising the deterministic
      // executor with variable substitution and healing.
      await stagehand.act({
        description: "the element to scroll on",
        selector: "/html/body/div/div/button",
        arguments: ["50%"],
        method: "scrollTo",
      });

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
    } finally {
      await stagehand.close();
    }
  },
);
