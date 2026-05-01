import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "observe_file_uploads" },
  async ({ debugUrl, sessionUrl, v3, logger }) => {
    try {
      const page = v3.context.pages()[0];
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/",
      );

      const observations = await v3.observe("find the file upload element");

      if (observations.length === 0) {
        return {
          _success: false,
          message: "observe returned no results",
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const expectedLocator = `xpath=/html/body/input`;

      const expectedBackendNodeId = await page
        .locator(expectedLocator)
        .backendNodeId();

      const actualBackendNodeId = await page
        .locator(observations[0].selector)
        .backendNodeId();
      const foundMatch = expectedBackendNodeId === actualBackendNodeId;

      return {
        _success: foundMatch,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        message: "returned selector does not resolve to same node as expected",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await v3.close();
    }
  },
);
