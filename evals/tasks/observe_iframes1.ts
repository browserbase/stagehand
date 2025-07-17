import { EvalFunction } from "@/types/evals";

export const observe_iframes1: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://tucowsdomains.com/abuse-form/phishing/");

    const observations = await stagehand.page.observe({
      instruction: "find the main header of the page",
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

    const possibleLocators = [
      `#primary > div.singlePage > section > div > div > article > div > iframe`,
      `#primary > div.heroBanner > section > div > h1`,
    ];

    const possibleHandles = [];
    for (const locatorStr of possibleLocators) {
      const locator = stagehand.page.locator(locatorStr);
      const handle = await locator.elementHandle();
      if (handle) {
        possibleHandles.push({ locatorStr, handle });
      }
    }

    let foundMatch = false;
    let matchedLocator: string | null = null;

    for (const observation of observations) {
      try {
        const observationLocator = stagehand.page
          .locator(observation.selector)
          .first();
        const observationHandle = await observationLocator.elementHandle();
        if (!observationHandle) {
          continue;
        }

        for (const { locatorStr, handle: candidateHandle } of possibleHandles) {
          const isSameNode = await observationHandle.evaluate(
            (node, otherNode) => node === otherNode,
            candidateHandle,
          );
          if (isSameNode) {
            foundMatch = true;
            matchedLocator = locatorStr;
            break;
          }
        }

        if (foundMatch) {
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
      matchedLocator,
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
