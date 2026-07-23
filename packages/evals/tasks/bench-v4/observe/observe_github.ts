import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "observe_github" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/github/",
      );

      const observations = await stagehand.observe(
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

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page: resolve the observed selector and each
      // candidate selector and compare element references. Candidates that
      // fail to resolve are ignored, as in v3.
      let foundMatch = false;
      let matchedLocator: string | null = null;

      for (const observation of observations) {
        try {
          const matched = await page.evaluate(
            ({
              observedSelector,
              candidateSelectors,
            }: {
              observedSelector: string;
              candidateSelectors: string[];
            }) => {
              const resolve = (selector: string): Element | null => {
                const raw = selector.startsWith("xpath=")
                  ? selector.slice("xpath=".length)
                  : selector;
                if (raw.startsWith("/") || raw.startsWith("(")) {
                  const result = document.evaluate(
                    raw,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null,
                  );
                  return result.singleNodeValue as Element | null;
                }
                return document.querySelector(raw);
              };

              const observed = resolve(observedSelector);
              if (!observed) return null;
              for (const candidate of candidateSelectors) {
                if (resolve(candidate) === observed) return candidate;
              }
              return null;
            },
            {
              observedSelector: observation.selector,
              candidateSelectors: possibleLocators,
            },
          );
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
        error: error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
