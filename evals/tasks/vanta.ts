import { EvalFunction } from "@/types/evals";

export const vanta: EvalFunction = async ({ stagehand, logger }) => {
  await stagehand.page.goto("https://www.vanta.com/");
  await stagehand.page.act({ action: "close the cookies popup" });

  const observations = await stagehand.page.observe({ onlyVisible: true });

  if (observations.length === 0) {
    await stagehand.close();
    return {
      _success: false,
      observations,

      logs: logger.getLogs(),
    };
  }

  const expectedLocator = `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_link.is-tablet-margin-0.w-nav-link`;

  const expectedResult = await stagehand.page
    .locator(expectedLocator)
    .first()
    .innerHTML();

  let foundMatch = false;
  for (const observation of observations) {
    try {
      const observationResult = await stagehand.page
        .locator(observation.selector)
        .first()
        .innerHTML();

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
