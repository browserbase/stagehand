import { EvalFunction } from "@/types/evals";

export const observe_yc_startup: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.ycombinator.com/companies");
    await stagehand.page.waitForLoadState("networkidle");

    const observations = await stagehand.page.observe({
      instruction:
        "Click the container element that holds links to each of the startup companies. The companies each have a name, a description, and a link to their website.",
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
      `div._rightCol_i9oky_592`,
      `div._section_i9oky_163._results_i9oky_343`,
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
