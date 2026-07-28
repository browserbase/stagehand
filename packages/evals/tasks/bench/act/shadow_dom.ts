import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "shadow_dom" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/");
      await stagehand.act("click the button");
      const { data: extraction } = await stagehand.extract(
        "extract the page text",
        z.object({ extraction: z.string() }),
      );

      const pageText = extraction.extraction;

      if (pageText.includes("button successfully clicked")) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
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
