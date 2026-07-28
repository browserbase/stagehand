import { defineBenchTask } from "../../../framework/defineTask.js";
import { findMatchingSelector } from "../../../framework/observeSelectors.js";

export default defineBenchTask(
  { name: "observe_github" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/github/");

      const { data: observations } = await stagehand.observe(
        "find the scrollable element that holds the repos file tree.",
      );

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

      // Compare element identity rather than visible text, which may be duplicated.
      let foundMatch = false;
      let matchedLocator: string | null = null;

      for (const observation of observations) {
        try {
          const matched = await findMatchingSelector(page, observation.selector, possibleLocators);
          if (matched) {
            foundMatch = true;
            matchedLocator = matched;
            break;
          }
        } catch (error) {
          console.warn(
            `Failed to check observation with selector ${observation.selector}:`,
            error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
