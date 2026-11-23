import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "heal_custom_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/expand-dropdown/");

      const { data: healed } = await stagehand.act({
        description: "The 'Select a country' dropdown",
        selector: "/html/not-a-dropdown",
        arguments: [],
        method: "click",
      });

      if (!healed.success) {
        return {
          _success: false,
          message: `self-heal did not expand the dropdown: ${healed.message}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const pageText = await page.evaluate(() => document.body.innerText);

      if (pageText.includes("Canada")) {
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
