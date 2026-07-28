import { defineBenchTask } from "../../../framework/defineTask.js";
import { selectorsResolveToSameElement } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_iframes1" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/");

      const { data: observations } = await stagehand.observe("find the main header of the page");

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const possibleLocators = [
        `body > main > section.iframe-wrapper > iframe`,
        `body > header > h1`,
      ];

      // Both candidates live in the main frame, so an observation inside the
      // iframe cannot resolve to either candidate.
      let foundMatch = false;

      for (const observation of observations) {
        try {
          const matched = await selectorsResolveToSameElement(
            page,
            observation.selector,
            possibleLocators,
          );
          if (matched) {
            foundMatch = true;
            break;
          }
        } catch (error) {
          console.warn(
            `Failed to check observation with selector ${observation.selector}:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
      }

      return {
        _success: foundMatch,
        observations,
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
