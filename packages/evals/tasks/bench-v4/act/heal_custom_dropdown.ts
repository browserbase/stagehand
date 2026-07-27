import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "heal_custom_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    /**
     * This eval is meant to test whether we do not incorrectly attempt
     * the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
     * 'dropdown' that is not a <select> element.
     *
     * This kind of dropdown must be clicked to be expanded before being interacted
     * with.
     */

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/",
      );

      // V4 GAP (V4_API_LOGS.md #1): this eval exercises v3's self-healing
      // act(observeResult) path — v3 was given an intentionally invalid
      // selector ("/html/not-a-dropdown") and expected to heal by
      // re-locating "The 'Select a country' dropdown" and clicking it.
      // v4's stagehand.act accepts a string only, and the
      // replayObservedAction workaround replays via locators with no
      // healing, so the behavior under test cannot be exercised on v4.
      // Fail loudly rather than silently substitute a different behavior.
      throw new Error(
        "V4 GAP: v4 has no act(observeResult) self-healing replay (stagehand.act accepts a string only — V4_API_LOGS.md #1); heal_custom_dropdown cannot run on v4",
      );
    } catch (error) {
      return {
        _success: false,
        message: `error attempting to select an option from the dropdown: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
