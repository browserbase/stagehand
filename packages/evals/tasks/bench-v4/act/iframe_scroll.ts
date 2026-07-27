import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "iframe_scroll" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc-scroll/",
      );
      await stagehand.act("scroll down 50% inside the iframe");

      await new Promise((resolve) => setTimeout(resolve, 5000));

      // v3 evaluated inside page.frames()[1]; v4 exposes no frames() list,
      // so the same measurement is re-expressed via the same-origin iframe's
      // contentWindow/contentDocument.
      const scrollInfo = await page.evaluate(() => {
        const iframe = document.querySelector("iframe");
        const win = iframe?.contentWindow;
        const doc = iframe?.contentDocument;
        if (!win || !doc) {
          throw new Error("could not access iframe content");
        }
        return {
          scrollTop: win.scrollY + win.innerHeight / 2,
          scrollHeight: doc.documentElement.scrollHeight,
        };
      });

      const halfwayScroll = scrollInfo.scrollHeight / 2;
      const halfwayReached =
        Math.abs(scrollInfo.scrollTop - halfwayScroll) <= 1;
      const evaluationResult = halfwayReached
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
            message: `Scroll position (${scrollInfo.scrollTop}px) is not halfway down the page (${halfwayScroll}px).`,
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
