import { defineBenchTask } from "../../../framework/defineTask.js";
import { findMatchingSelector } from "../../../framework/observeSelectors.js";
import type { Action } from "@browserbasehq/stagehand";

export default defineBenchTask(
  { name: "observe_iframes2" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://iframetester.com/?url=https://shopify.com");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let observations: Action[];
      try {
        observations = (await stagehand.observe("find the main header of the page")).data;
      } catch (err) {
        return {
          _success: false,
          message: err instanceof Error ? err.message : String(err),
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const possibleLocators = [`#iframe-window`, `body > header > h1`];

      // Both candidate selectors live in the main frame. An observation
      // inside the cross-origin iframe will not resolve to either candidate.
      let foundMatch = false;
      let matchedLocator: string | null = null;

      for (const observation of observations) {
        try {
          const matched = await findMatchingSelector(page, observation.selector, possibleLocators);
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
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
