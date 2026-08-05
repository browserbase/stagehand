import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "tab_handling" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/");

      await stagehand.act("click the button to open the other page");

      // activePage() polls until the popup registers (stagehand#2458), so
      // the page list is complete after this settles.
      await stagehand.browser.context.activePage();

      const pages = await stagehand.browser.context.pages();
      const page1 = pages[0];
      const page2 = pages[1];

      // v3 used schemaless extract; v4 requires a schema.

      // extract all the text from the first page
      const { data: extraction1 } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
        { page: page1 },
      );
      // extract all the text from the second page
      const { data: extraction2 } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
        { page: page2 },
      );

      const extraction1Success = extraction1.extraction.includes("Welcome!");
      const extraction2Success = extraction2.extraction.includes("You’re on the other page");

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
