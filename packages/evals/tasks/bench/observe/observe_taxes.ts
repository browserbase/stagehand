import { defineBenchTask } from "../../../framework/defineTask.js";
import { selectorsResolveToSameElement } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_taxes" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://file.1040.com/estimate/");

      const { data: observations } = await stagehand.observe(
        "Find all the form input elements under the 'Income' section",
      );

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      } else if (observations.length < 13) {
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
          if (await selectorsResolveToSameElement(page, observation.selector, ["#tpWages"])) {
            foundMatch = true;
            break;
          }
        } catch (error) {
          console.warn(
            `Failed to check observation with selector ${observation.selector}:`,
            String(error),
          );
          continue;
        }
      }

      return {
        _success: foundMatch,
        expected: "#tpWages",
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
