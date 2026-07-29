import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "spif_in_osr" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    // this eval is designed to test whether stagehand can successfully
    // click inside a SPIF (same process iframe) that is inside an
    // OSR (open mode shadow) root

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-open-shadow-dom/",
      );
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
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
