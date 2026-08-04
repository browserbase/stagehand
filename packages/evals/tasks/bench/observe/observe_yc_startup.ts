import { defineBenchTask } from "../../../framework/defineTask.js";
import { matchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_yc_startup" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://www.ycombinator.com/companies", {
        waitUntil: "networkidle",
      });

      const { data: observations } = await stagehand.observe(
        "Click the container element that holds links to each of the startup companies. The companies each have a name, a description, and a link to their website.",
      );

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
        `div._rightCol_18olp_594`,
        `div._section_18olp_165._results_18olp_345`,
      ];

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // so the same element-identity check is
      // re-expressed in-page: resolve the observed selector and each
      // candidate selector and compare element references.
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
