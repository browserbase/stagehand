import { EvalFunction } from "@/types/evals";

export const observe_github: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/github/",
    );

    const observations = await stagehand.page.observe({
      instruction:
        "find the scrollable element that holds the repos file tree.",
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
      `#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ`,
      `#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div`,
      `#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div > div.prc-PageLayout-Pane-Vl5LI`,
      `#repo-content-pjax-container > react-app > div > div > div.prc-PageLayout-PageLayoutRoot-1zlEO > div > div > div.Box-sc-g0xbh4-0.gISSDQ > div > div.prc-PageLayout-Pane-Vl5LI > div`,
      `#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_`,
      `#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div`,
      `#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div`,
      `#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div > div > nav`,
      `#repos-file-tree > div.Box-sc-g0xbh4-0.ReposFileTreePane-module__Box_5--tQNH_ > div > div > div > nav > ul`,
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
