import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "hidden_input_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/hidden-input-dropdown/");

      await stagehand.act("click to expand the 'Favourite Colour' dropdown");

      const { data: extraction } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );
      const fullTree = extraction.extraction;

      if (fullTree.includes("Green")) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: "unable to expand the dropdown",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        message: `error attempting click to expand the dropdown: ${error instanceof Error ? error.message : String(error)}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
