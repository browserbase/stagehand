import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "nonsense_action" },
  async ({ debugUrl, sessionUrl, v3, logger }) => {
    try {
      const page = v3.context.pages()[0];
      await page.goto("https://www.homedepot.com/");

      const result = await v3.act("what is the capital of the moon?");

      return {
        _success: !result.success, // We expect this to fail
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
      await v3.close();
    }
  },
);
