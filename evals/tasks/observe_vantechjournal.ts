import { EvalFunction } from "@/types/evals";

export const observe_vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://vantechjournal.com/archive?page=8");
  await stagehand.page.waitForTimeout(1000);

  const observations = await stagehand.page.observe({
    instruction: "find the button that takes us to the 11th page",
  });

  if (observations.length === 0) {
    await stagehand.close();
    return {
      _success: false,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }

  const expectedLocator = `a.rounded-lg:nth-child(8)`;

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

  await stagehand.close();

  return {
    _success: foundMatch,
    expected: expectedResult,
    observations,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
