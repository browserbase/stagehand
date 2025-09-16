import { EvalFunction } from "@/types/evals";

export const observe_yc_startup: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.ycombinator.com/companies");
    await page.waitForLoadState("networkidle");

    const observations = await v3.observe({
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
