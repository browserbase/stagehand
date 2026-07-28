import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "sciquest" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://bids.sciquest.com/apps/Router/PublicEvent?tab=PHX_NAV_SourcingAllOpps&CustomerOrg=StateOfUtah",
      );
      await stagehand.act('Click on the "Closed" tab');

      const { data } = await stagehand.extract(
        "Extract the total number of results that the search produced, not the number displayed on the current page.",
        z.object({ total_results: z.string() }),
      );

      const expectedNumber = 12637;
      const extractedNumber = Number.parseInt(data.total_results.replace(/[^\d]/g, ""), 10);
      const success =
        extractedNumber >= expectedNumber - 1000 && extractedNumber <= expectedNumber + 1000;

      return {
        _success: success,
        extractedNumber,
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
