import { EvalFunction } from "@/types/evals";

export const observe_taxes: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://file.1040.com/estimate/");

    const observations = await stagehand.page.observe({
      instruction:
        "Find all the form input elements under the 'Income' section",
    });

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

    const expectedLocator = `#tpWages`;

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
