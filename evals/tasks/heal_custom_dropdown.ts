import { EvalFunction } from "@/types/evals";

export const heal_custom_dropdown: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  /**
   * This eval is meant to test whether we do not incorrectly attempt
   * the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
   * 'dropdown' that is not a <select> element.
   *
   * This kind of dropdown must be clicked to be expanded before being interacted
   * with.
   */

  try {
    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/",
    );

    await page.act({
      description: "The 'Select a country' dropdown",
      selector: "/html/not-a-dropdown",
      arguments: [],
      method: "click",
    });

    // we are expecting stagehand to click the dropdown to expand it,
    // and therefore the available options should now be contained in the full
    // a11y tree.

    // to test, we'll grab the full a11y tree, and make sure it contains 'Canada'
    const extraction = await page.extract();
    const fullTree = extraction.page_text;

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
      message: `error attempting to select an option from the dropdown: ${error.message}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
