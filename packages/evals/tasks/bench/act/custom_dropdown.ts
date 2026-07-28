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

      const selection = await page.evaluate(() => ({
        label: document.querySelector("#countryLabel")?.textContent?.trim(),
        confirmation: document.querySelector("#chosenValue")?.textContent?.trim(),
      }));
      const selectedCanada =
        selection.label === "Canada" && selection.confirmation === "You chose: Canada (ca)";

      if (selectedCanada) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: "Canada was not selected from the dropdown",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
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
