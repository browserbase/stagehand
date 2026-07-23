import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "hidden_input_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    /**
     * This eval is meant to test whether we do not incorrectly attempt
     * the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
     * hidden input 'dropdown'.
     *
     * This kind of dropdown must be clicked to be expanded before being interacted
     * with.
     */

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/hidden-input-dropdown/",
      );

      await stagehand.act("click to expand the 'Favourite Colour' dropdown");

      // we are expecting stagehand to click the dropdown to expand it,
      // and therefore the available options should now be contained in the full
      // a11y tree.

      // to test, we'll grab the full a11y tree, and make sure it contains 'Green'
      // v3 used schemaless extract (V4_API_LOGS #2); v4 requires a schema.
      // Single-word key to stay clear of the snake_case wire-casing bug (#14).
      const extraction = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
      );
      const fullTree = extraction.extraction;

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
        message: `error attempting click to expand the dropdown: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
