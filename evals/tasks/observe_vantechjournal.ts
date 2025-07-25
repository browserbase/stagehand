import { EvalFunction } from "@/types/evals";

export const observe_vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://vantechjournal.com/archive");
    await stagehand.page.waitForTimeout(1000);

    const observations = await stagehand.page.observe({
      instruction: "Find the 'load more' link",
    });

    if (observations.length === 0) {
      return {
        _success: false,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const expectedLocator = `xpath=/html/body/div[3]/section/div/div/div[3]/a`;

    const expectedResult = await stagehand.page.locator(expectedLocator);

    let foundMatch = false;

    for (const observation of observations) {
      try {
        const observationLocator = stagehand.page
          .locator(observation.selector)
          .first();
        const observationHandle = await observationLocator.elementHandle();
        const expectedHandle = await expectedResult.elementHandle();

        if (!observationHandle || !expectedHandle) {
          // Couldn’t get handles, skip
          continue;
        }

        const isSameNode = await observationHandle.evaluate(
          (node, otherNode) => node === otherNode,
          expectedHandle,
        );

        if (isSameNode) {
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
