import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "tab_handling" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/");

      await stagehand.act("click the button to open the other page");

      const page2 = await stagehand.context.activePage();
      if (!page2) {
        throw new Error("No active page after opening the new tab");
      }
      const pages = await stagehand.context.pages();
      let page1: (typeof pages)[number] | undefined;
      for (const candidate of pages) {
        if (
          (await candidate.url()) ===
          "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/"
        ) {
          page1 = candidate;
          break;
        }
      }
      if (!page1) {
        throw new Error("Could not find the opener page after opening the new tab");
      }

      await stagehand.context.setActivePage(page1);
      const { data: extraction1 } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );
      await stagehand.context.setActivePage(page2);
      const { data: extraction2 } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
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
