import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "vantechjournal" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://vantechjournal.com");

      await stagehand.act("click on page 'recommendations'");

      const expectedUrl = "https://vantechjournal.com/recommendations";
      const currentUrl = await page.url();

      return {
        _success: currentUrl === expectedUrl,
        currentUrl,
        expectedUrl,
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
