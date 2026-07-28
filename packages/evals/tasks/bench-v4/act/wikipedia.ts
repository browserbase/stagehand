import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "wikipedia" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(`https://en.wikipedia.org/wiki/Baseball`);
      await stagehand.act('click the "hit and run" link in this article', {
        timeout: 360_000,
      });

      const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
      const currentUrl = await page.url();

      return {
        _success: currentUrl === url,
        expected: url,
        actual: currentUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
