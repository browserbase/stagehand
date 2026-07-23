import { defineBenchV4Task } from "../../../framework/defineTask.js";
import {
  replayObservedAction,
  type ObservedAction,
} from "../../../framework/observeReplay.js";

export default defineBenchV4Task(
  { name: "no_js_click" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    /**
     * This eval is meant to test whether our `clickElement` function
     * (inside actHandlerUtils.ts) is able to click elements even if
     * the site blocks programmatic JS click events.
     */

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/",
      );

      const observeResult: ObservedAction = {
        method: "click",
        selector: "xpath=/html/body/button",
        description: "the button to click",
        arguments: [],
      };
      // v4 has no act(observeResult) replay — see V4_API_LOGS.md #1.
      await replayObservedAction(page, observeResult);

      const text = await page.locator("#success-msg").textContent();
      if (text?.trim() === "click succeeded") {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message:
          "unable to click element on website that blocks JS click events",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        message: `error attempting to click the button: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
