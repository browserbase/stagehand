import { EvalFunction } from "../types/evals";

export const custom_dropdown: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
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
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/",
    );

    await v3.act("choose Canada from the 'Select a Country' dropdown");

    // to test, we'll grab the full a11y tree, and make sure it contains 'Canada'
    const extraction = await v3.extract();
    const fullTree = extraction.pageText;

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
    await v3.close();
  }
};
