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

      // Self-healing act(Action) replay (restored by
      // stagehand#2427): same intentionally invalid selector as the v3
      // twin — healing must re-locate "The 'Select a country' dropdown"
      // and click it to expand.
      const { data: healed } = await stagehand.act({
        description: "The 'Select a country' dropdown",
        selector: "/html/not-a-dropdown",
        arguments: [],
        method: "click",
      });

      // Report a failed heal directly rather than letting it surface as an
      // absent dropdown option. Healing requires selfHeal: true at init; the
      // server defaults it off and it cannot be set per-call.
      if (!healed.success) {
        return {
          _success: false,
          message: `self-heal did not expand the dropdown: ${healed.message}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // If the dropdown expanded, its options are now rendered in the DOM.
      // (v3 checked the schemaless-extract page text; v4 extract requires a
      // schema, so read the rendered text directly — same signal, no LLM.)
      const pageText = await page.evaluate(() => document.body.innerText);

      if (pageText.includes("Canada")) {
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
