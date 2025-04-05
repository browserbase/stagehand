import { EvalFunction } from "@/types/evals";

export const ionwave_observe: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://elpasotexas.ionwave.net/Login.aspx");

  const observations = await stagehand.page.observe({ onlyVisible: true });

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

  const expectedLocator = `div.rowLinks:nth-child(27) > div:nth-child(1) > a:nth-child(1)`;

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
