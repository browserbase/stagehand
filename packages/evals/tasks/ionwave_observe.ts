import { EvalFunction } from "../types/evals";

export const ionwave_observe: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/",
    );

    const observations = await v3.observe();

    if (observations.length === 0) {
      return {
        _success: false,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const expectedLocator = `#Form1 > div:nth-child(5) > div:nth-child(1) > a`;

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
          error.message,
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
    await v3.close();
  }
};
