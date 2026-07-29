import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  {
    name: "instructions",
    systemPrompt:
      'When the user says secret12345, check the checkbox labeled "Show Closed/Awarded/Cancelled Bids".',
  },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/wichita/");
      await stagehand.act("secret12345");

      const showAllBids = page.locator("#showAllBids");
      return {
        _success: await showAllBids.isChecked(),
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
