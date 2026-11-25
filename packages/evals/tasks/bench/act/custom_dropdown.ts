import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "custom_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/expand-dropdown/");

      await stagehand.act("choose Canada from the 'Select a Country' dropdown");

      const fullTree = await page.locator("#chosenValue").innerText();

      if (fullTree.includes("Canada")) {
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
        message: `error attempting to select an option from the dropdown: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
