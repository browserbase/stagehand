import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "tab_handling" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/new-tab/");

      await stagehand.act("click the button to open the other page");

      await stagehand.browser.context.activePage();

      const pages = await stagehand.browser.context.pages();
      const page1 = pages[0];
      const page2 = pages[1];

      const { data: extraction1 } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
        { page: page1 },
      );
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
    }
  },
);
