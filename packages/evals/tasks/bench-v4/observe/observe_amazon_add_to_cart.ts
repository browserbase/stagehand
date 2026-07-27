import { defineBenchV4Task } from "../../../framework/defineTask.js";
import { replayObservedAction } from "../../../framework/observeReplay.js";

export default defineBenchV4Task(
  { name: "observe_amazon_add_to_cart" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
      );

      const observations1 = await stagehand.observe(
        "Find and click the 'Add to Cart' button",
      );

      // Example of using performPlaywrightMethod if you have the xpath
      if (observations1.length > 0) {
        const action1 = observations1[0];
        // v3's act(observeResult) replay — consumer-side in v4 (V4_API_LOGS.md #1)
        await replayObservedAction(page, action1);
      }

      const observations2 = await stagehand.observe(
        "Find and click the 'Proceed to checkout' button",
      );

      // Example of using performPlaywrightMethod if you have the xpath
      if (observations2.length > 0) {
        const action2 = observations2[0];
        // v3's act(observeResult) replay — consumer-side in v4 (V4_API_LOGS.md #1)
        await replayObservedAction(page, action2);
      }

      const currentUrl = await page.url();
      const expectedUrlPrefix =
        "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html";

      return {
        _success: currentUrl.startsWith(expectedUrlPrefix),
        currentUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
