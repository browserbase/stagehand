import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "peeler_complex" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://chefstoys.com/", { timeout: 60000 });
      await page.waitForLoadState("networkidle");

      await stagehand.act("find the button to close the popup");
      await stagehand.act("search for %search_query%", {
        variables: { search_query: "peeler" },
      });
      await stagehand.act('click on the first "OXO" brand peeler');

      const { data } = await stagehand.extract(
        "Get the price of the peeler",
        z.object({ price: z.number().nullable() }),
      );

      return {
        _success: data.price === 11.99,
        price: data.price,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
