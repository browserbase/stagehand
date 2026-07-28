import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "csr_in_spif" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    // this eval is designed to test whether stagehand can successfully
    // click inside an CSR (closed mode shadow) root that is inside an
    // SPIF (same process iframe)

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-dom-in-spif/",
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
    } finally {
      await stagehand.close();
    }
  },
);
