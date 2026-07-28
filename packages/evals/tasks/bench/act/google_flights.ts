import { defineBenchTask } from "../../../framework/defineTask.js";
import type { Action } from "@browserbasehq/stagehand";

/**
 * This eval replays a click that must bypass normal actionability checks.
 */

export default defineBenchTask(
  { name: "google_flights" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/");

      const action: Action = {
        selector:
          "xpath=/html/body/c-wiz[2]/div/div[2]/c-wiz/div[1]/c-wiz/div[2]/div[2]/div[2]/div/div[2]/div[1]/ul/li[1]/div/div[1]",
        description: "the first departing flight",
        method: "click",
        arguments: [],
      };
      await stagehand.act(action);

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/return-flight.html";
      const currentUrl = await page.url();

      return {
        _success: currentUrl === expectedUrl,
        currentUrl,
        ...(currentUrl === expectedUrl
          ? {}
          : { error: "The current URL does not match expected." }),
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
