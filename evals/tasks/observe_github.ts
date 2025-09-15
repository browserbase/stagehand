import { EvalFunction } from "@/types/evals";

export const observe_github: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/github/",
    );

    const observations = await v3.observe({
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

    let foundMatch = false;
    let matchedLocator: string | null = null;

    const nodesEqual = async (
      obsSel: string,
      candSel: string,
    ): Promise<boolean> => {
      return page.evaluate(
        ({ obsSel, candSel }) => {
          function resolve(sel: string): Element | null {
            if (!sel) return null;
            const raw = sel.trim();
            // Support both xpath= prefix and raw XPath (starting with / or () )
            const looksLikeXPath =
              /^xpath=/i.test(raw) ||
              raw.startsWith("/") ||
              raw.startsWith("(");
            if (looksLikeXPath) {
              try {
                const xp = raw.replace(/^xpath=/i, "");
                return document.evaluate(
                  xp,
                  document,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null,
                ).singleNodeValue as Element | null;
              } catch {
                return null;
              }
            }
            try {
              return document.querySelector(raw);
            } catch {
              return null;
            }
          }

          const a = resolve(obsSel);
          const b = resolve(candSel);
          return a === b;
        },
        { obsSel, candSel },
      );
    };

    for (const observation of observations) {
      try {
        for (const locatorStr of possibleLocators) {
          const isSameNode = await nodesEqual(observation.selector, locatorStr);
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
    await v3.close();
  }
};
