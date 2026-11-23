import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "oopif_in_osr" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/oopif-in-open-shadow-dom/");
      await stagehand.act("fill 'nunya' into the first name field");

      const { data: extraction } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );

      const pageText = extraction.extraction;

      if (pageText.includes("nunya")) {
        return {
          _success: true,
          message: `successfully filled the form`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: `unable to fill the form`,
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
    }
  },
);
