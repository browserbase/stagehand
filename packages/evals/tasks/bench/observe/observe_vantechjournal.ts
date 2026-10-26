import { defineBenchTask } from "../../../framework/defineTask.js";
import { matchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_vantechjournal" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://vantechjournal.com/archive");

      const { data: observations } = await stagehand.observe("Find the 'load more' link");

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // The archive layout changes independently of the pagination link.
      const expectedLocators = [
        "xpath=//a[@href='/archive?page=2' and normalize-space(.)='Load more']",
        "xpath=//a[@href='/archive?page=2' and normalize-space(.)='Load more']/span",
      ];

      // v3 compares backendNodeIds (first observation vs. each expected
      // locator); the v4 Locator exposes no node identity
      // so the same element-identity check is
      // re-expressed in-page: resolve the observed selector and each
      // expected selector and compare element references. Expected locators
      // that fail to resolve are skipped, as in v3.
      const foundMatch =
        (await matchingSelector(page, observations[0].selector, expectedLocators)) !== null;

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
    }
  },
);
