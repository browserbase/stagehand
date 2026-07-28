import { defineBenchV4Task } from "../../../framework/defineTask.js";
import { findMatchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchV4Task(
  { name: "observe_vantechjournal" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://vantechjournal.com/archive");

      const observations = await stagehand.observe("Find the 'load more' link");

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const expectedLocators = [
        "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a",
        "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a/span",
      ];

      // v3 compares backendNodeIds (first observation vs. each expected
      // locator); the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page via the shared findMatchingSelector helper.
      // Expected locators that fail to resolve are skipped, as in v3.
      const foundMatch =
        (await findMatchingSelector(page, observations[0].selector, expectedLocators)) !== null;

      return {
        _success: foundMatch,
        expected: expectedLocators,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error: unknown) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
