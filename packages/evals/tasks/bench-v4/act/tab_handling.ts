import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "tab_handling" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/",
      );

      await stagehand.act("click the button to open the other page");

      const pages = await stagehand.context.pages();
      const page1 = pages[0];
      const page2 = pages[1];

      // V4 GAP: extract has no { page } option (v3:
      // v3.extract({ page: pageN })) — activate each target page via
      // setActivePage before extracting. v3 also used schemaless extract
      // (V4_API_LOGS #2); v4 requires a schema. Single-word key to stay
      // clear of the snake_case wire-casing bug (#14).

      // extract all the text from the first page
      await stagehand.context.setActivePage(page1);
      const extraction1 = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );
      // extract all the text from the second page
      await stagehand.context.setActivePage(page2);
      const extraction2 = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );

      const extraction1Success = extraction1.extraction.includes("Welcome!");
      const extraction2Success = extraction2.extraction.includes(
        "You’re on the other page",
      );

      return {
        _success: extraction1Success && extraction2Success,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        message: (error as Error).message,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
