import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "bidnet" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://www.bidnetdirect.com/");

      await stagehand.act('Click on the "Construction" keyword');

      const expectedUrl =
        "https://www.bidnetdirect.com/public/solicitations/open?keywords=Construction";
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
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
