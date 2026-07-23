import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "panamcs" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/panamcs/",
      );

      const observations = await stagehand.observe("click the 'about us' link");

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const expectedLocator = `#menu > li:nth-child(1) > a`;

      const expectedResult = await page
        .locator(expectedLocator)
        .first()
        .innerText();

      let foundMatch = false;
      for (const observation of observations) {
        try {
          const observationResult = await page
            .locator(observation.selector)
            .first()
            .innerText();

          if (observationResult === expectedResult) {
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
        expected: expectedResult,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
