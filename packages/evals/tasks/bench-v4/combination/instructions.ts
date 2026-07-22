import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "instructions" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://docs.browserbase.com/");

      await page.act("secret12345");

      await page.waitForLoadState("domcontentloaded");

      const url = await page.url();

      const isCorrectUrl =
        url === "https://docs.browserbase.com/introduction/what-is-browserbase";

      return {
        _success: isCorrectUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: JSON.parse(JSON.stringify(error, null, 2)),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
