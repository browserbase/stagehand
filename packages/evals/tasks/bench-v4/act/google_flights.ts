import { defineBenchV4Task } from "../../../framework/defineTask.js";
import {
  replayObservedAction,
  type ObservedAction,
} from "../../../framework/observeReplay.js";

/**
 * This eval attempts to click on an element that should not pass the playwright actionability check
 * which happens by default if you call locator.click (more information here:
 * https://playwright.dev/docs/actionability)
 *
 * If this eval passes, it means that we have correctly set {force: true} in performPlaywrightMethod,
 * and the click was successful even though the target element (found by the xpath) did not
 * pass the actionability check.
 */

export default defineBenchV4Task(
  { name: "google_flights" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/",
      );

      const observeResult: ObservedAction = {
        selector:
          "xpath=/html/body/c-wiz[2]/div/div[2]/c-wiz/div[1]/c-wiz/div[2]/div[2]/div[2]/div/div[2]/div[1]/ul/li[1]/div/div[1]",
        description: "the first departing flight",
        method: "click",
        arguments: [],
      };
      // v4 has no act(observeResult) replay — see V4_API_LOGS.md #1.
      await replayObservedAction(page, observeResult);

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/return-flight.html";
      const currentUrl = await page.url();

      await stagehand.close();

      if (currentUrl === expectedUrl) {
        return {
          _success: true,
          currentUrl,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        error: "The current URL does not match expected.",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
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
