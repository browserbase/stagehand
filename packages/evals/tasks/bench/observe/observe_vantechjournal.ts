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

      const expectedLocators = [
        "xpath=//a[@href='/archive?page=2' and normalize-space(.)='Load more']",
        "xpath=//a[@href='/archive?page=2' and normalize-space(.)='Load more']/span",
      ];

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
