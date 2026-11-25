import { defineBenchTask } from "../../../framework/defineTask.js";
import type { Action } from "@browserbasehq/stagehand";

export default defineBenchTask(
  { name: "google_flights" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/google-flights/");

      const observeResult: Action = {
        selector:
          "xpath=/html/body/c-wiz[2]/div/div[2]/c-wiz/div[1]/c-wiz/div[2]/div[2]/div[2]/div/div[2]/div[1]/ul/li[1]/div/div[1]",
        description: "the first departing flight",
        method: "click",
        arguments: [],
      };
      await stagehand.act(observeResult);

      const expectedUrl =
        "https://stagehand-eval-sites.vercel.app/sites/google-flights/return-flight.html";
      const currentUrl = await page.url();

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
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
