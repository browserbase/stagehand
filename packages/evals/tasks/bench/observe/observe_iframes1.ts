import { defineBenchV4Task } from "../../../framework/defineTask.js";
import { matchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchV4Task(
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

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // so the same element-identity check is
      // re-expressed in-page. Both candidate selectors live in the main
      // frame, so main-frame resolution preserves the v3 pass criterion:
      // an observed selector that points inside the iframe never had a
      // backendNodeId equal to either main-frame candidate in v3 (no match),
      // and here it simply fails to resolve in the main document (no match).
      let foundMatch = false;
      let matchedLocator: string | null = null;

      for (const observation of observations) {
        try {
          const matched = await matchingSelector(page, observation.selector, possibleLocators);
          if (matched) {
            foundMatch = true;
            matchedLocator = matched;
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
        matchedLocator,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
