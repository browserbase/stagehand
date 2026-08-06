import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "custom_dropdown" },
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
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/");

      await stagehand.act("choose Canada from the 'Select a Country' dropdown");

      // read the rendered page text directly — no second model call
      const fullTree = await page.locator("#chosenValue").innerText();

      if (fullTree.includes("Canada")) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: "unable to expand the dropdown",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
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
