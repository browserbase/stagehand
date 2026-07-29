import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "ionwave" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/");

      await stagehand.act('Click on "Closed Bids"');

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/closed-bids.html";
      const currentUrl = await page.url();

      return {
        _success: currentUrl.startsWith(expectedUrl),
        currentUrl,
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
