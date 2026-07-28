import { defineBenchTask } from "../../../framework/defineTask.js";
import { findMatchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "ionwave_observe" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/");

      const { data: observations } = await stagehand.observe();

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      let foundMatch = false;
      for (const observation of observations) {
        try {
          if (
            await findMatchingSelector(page, observation.selector, [
              "#Form1 > div:nth-child(5) > div:nth-child(1) > a",
            ])
          ) {
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
        expected: "#Form1 > div:nth-child(5) > div:nth-child(1) > a",
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
