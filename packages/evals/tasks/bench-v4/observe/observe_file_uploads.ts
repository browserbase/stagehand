import { defineBenchV4Task } from "../../../framework/defineTask.js";
import { findMatchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchV4Task(
  { name: "observe_file_uploads" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/");

      const observations = await stagehand.observe("find the file upload element");

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

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page via the shared findMatchingSelector helper.
      const foundMatch =
        (await findMatchingSelector(page, observations[0].selector, [expectedLocator])) !== null;

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
        error: error instanceof Error ? error.message : String(error),
        message: "returned selector does not resolve to same node as expected",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
