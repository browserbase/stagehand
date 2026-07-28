import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
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
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/");

      await stagehand.act({
        description: "The 'Select a country' dropdown",
        selector: "/html/not-a-dropdown",
        arguments: [],
        method: "click",
      });

      const dropdownExpanded = await page.evaluate(() =>
        document.querySelector("#countryDropdown")?.classList.contains("open"),
      );

      return {
        _success: dropdownExpanded === true,
        ...(dropdownExpanded === true ? {} : { message: "unable to expand the dropdown" }),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        message: `error attempting to expand the dropdown: ${
          error instanceof Error ? error.message : String(error)
        }`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
