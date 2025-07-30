import { EvalFunction } from "@/types/evals";

export const panamcs: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/panamcs/",
    );

    const observations = await stagehand.page.observe(
      "click the 'about us' link",
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

    const expectedLocator = `#menu > li:nth-child(1) > a`;

    const expectedResult = await stagehand.page
      .locator(expectedLocator)
      .first()
      .innerText();

    let foundMatch = false;
    for (const observation of observations) {
      try {
        const observationResult = await stagehand.page
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
    await stagehand.close();
  }
};
