import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "osr_in_oopif" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/open-shadow-root-in-oopif/");
      await stagehand.act("click the button");

      const { data: extraction } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );

      const pageText = extraction.extraction;

      if (pageText.includes("button successfully clicked")) {
        return {
          _success: true,
          message: `successfully clicked the button`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: `unable to click on the button`,
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
