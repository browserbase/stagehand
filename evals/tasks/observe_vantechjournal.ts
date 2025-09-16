import { EvalFunction } from "@/types/evals";

export const observe_vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://vantechjournal.com/archive");

    const observations = await v3.observe({
      instruction: "Find the 'load more' link",
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

    const expectedLocator = `xpath=/html/body/div[3]/div/section/div/div/div[3]/a`;

    const nodesEqual = async (aSel: string, bSel: string): Promise<boolean> => {
      return page.evaluate(
        ({ aSel, bSel }) => {
          function resolve(sel: string): Element | null {
            if (!sel) return null;
            const raw = sel.trim();
            const isXPath =
              /^xpath=/i.test(raw) ||
              raw.startsWith("/") ||
              raw.startsWith("(");
            if (isXPath) {
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
          const a = resolve(aSel);
          const b = resolve(bSel);
          return a === b;
        },
        { aSel, bSel },
      );
    };

    let foundMatch = false;
    for (const observation of observations) {
      try {
        const equal = await nodesEqual(observation.selector, expectedLocator);
        if (equal) {
          foundMatch = true;
          break;
        }
      } catch (error) {
        console.warn(
          `Failed to compare ${observation.selector} to expected`,
          error?.message || String(error),
        );
        continue;
      }
    }

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
