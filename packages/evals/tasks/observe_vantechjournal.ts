import { EvalFunction } from "../types/evals";

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

    const expectedLocators = [
      "xpath=/html/body/div[2]/div/section/div/div/div[3]/a",
      "xpath=/html/body/div[2]/div/section/div/div/div[3]/a/span",
    ];

    const expectedIds: number[] = [];
    for (const locator of expectedLocators) {
      const node = page.locator(locator);
      const id = await node.backendNodeId();
      if (id !== undefined && id !== null) expectedIds.push(id);
    }

    const observedNode = page.locator(observations[0].selector);
    const observedId = await observedNode.backendNodeId();

    const foundMatch = expectedIds.includes(observedId);

    return {
      _success: foundMatch,
      expected: expectedLocators,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error: unknown) {
    return {
      _success: false,
      error: error instanceof Error ? error.message : String(error),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
