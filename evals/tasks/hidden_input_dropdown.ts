import { EvalFunction } from "@/types/evals";

export const hidden_input_dropdown: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  /**
   * This eval is meant to test whether we do not incorrectly attempt
   * the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
   * hidden input 'dropdown'.
   *
   * This kind of dropdown must be clicked to be expanded before being interacted
   * with.
   */

  try {
    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/hidden-input-dropdown/",
    );

    await page.act("click to expand the 'Favourite Colour' dropdown");

    // we are expecting stagehand to click the dropdown to expand it,
    // and therefore the available options should now be contained in the full
    // a11y tree.

    // to test, we'll grab the full a11y tree, and make sure it contains 'Green'
    const extraction = await page.extract();
    const fullTree = extraction.page_text;

    if (fullTree.includes("Green")) {
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
      message: `error attempting click to expand the dropdown: ${error.message}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
