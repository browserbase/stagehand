import { defineBenchTask } from "../../../framework/defineTask.js";
import { selectorsResolveToSameElement } from "../../../framework/observeSelectors.js";

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
        "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a",
        "xpath=/html/body/div[2]/div/div/section/div/div/div[3]/a/span",
      ];

      const foundMatch = await selectorsResolveToSameElement(
        page,
        observations[0].selector,
        expectedLocators,
      );

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
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
