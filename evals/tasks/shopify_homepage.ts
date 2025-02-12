import { EvalFunction } from "@/types/evals";

export const shopify_homepage: EvalFunction = async ({ stagehand, logger }) => {
  await stagehand.page.goto("https://www.shopify.com/");

  const observations = await stagehand.page.observe({ onlyVisible: true });

  if (observations.length === 0) {
    await stagehand.close();
    return {
      _success: false,
      observations,

      logs: logger.getLogs(),
    };
  }

  const expectedLocator = `body > div.relative > header > div > div > div.ml-auto > ul.lg\\:flex.hidden.items-center > li.leading-\\[0\\] > a`;

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

    logs: logger.getLogs(),
  };
};
