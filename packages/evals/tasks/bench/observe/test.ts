import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "test" },
  async ({ v3, logger, debugUrl, sessionUrl }) => {
    try {
      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // TODO: implement eval logic
      await v3.observe("find the button");

      return {
        _success: true,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
