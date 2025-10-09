import { EvalFunction } from "@/lib/v3/types/public/evals";

export const observe_vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://vantechjournal.com/archive");

    const observations = await v3.observe("Find the 'load more' link");

    if (observations.length === 0) {
      return {
        _success: false,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const expectedLocator = `xpath=/html/body/div[2]/div/section/div/div/div[3]/a`;

    const expectedId = await page.locator(expectedLocator).backendNodeId();
    const idFoundByObserve = await page
      .locator(observations[0].selector)
      .backendNodeId();
    const foundMatch = expectedId === idFoundByObserve;

    return {
      _success: foundMatch,
      expected: expectedLocator,
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
