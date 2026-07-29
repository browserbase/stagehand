import { defineBenchTask } from "../../../framework/defineTask.js";
import { selectorsResolveToSameElement } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_file_uploads" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/");

      const { data: observations } = await stagehand.observe("find the file upload element");

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

      const foundMatch = await selectorsResolveToSameElement(page, observations[0].selector, [
        expectedLocator,
      ]);

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
        error: String(error),
        message: "returned selector does not resolve to same node as expected",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
