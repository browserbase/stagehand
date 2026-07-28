import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "nonsense_action" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://www.homedepot.com/");

      const result = await stagehand.act("what is the capital of the moon?");

      return {
        _success: !result.data.success, // We expect this to fail
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
