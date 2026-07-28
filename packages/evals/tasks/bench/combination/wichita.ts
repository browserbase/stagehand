import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "wichita" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/wichita/");
      await stagehand.act('Click on "Show Closed/Awarded/Cancelled bids"');

      const { data } = await stagehand.extract(
        "Extract the total number of bids that the search produced.",
        z.object({ total_results: z.number() }),
      );

      return {
        _success: data.total_results === 430,
        total_results: data.total_results,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
