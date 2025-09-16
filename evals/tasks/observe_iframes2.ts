import { EvalFunction } from "@/types/evals";
import { ObserveResult } from "@/types/stagehand";

export const observe_iframes2: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://iframetester.com/?url=https://shopify.com");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    let observations: ObserveResult[];
    try {
      observations = await v3.observe({
        instruction: "find the main header of the page",
      });
    } catch (err) {
      return {
        _success: false,
        message: err.message,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (observations.length === 0) {
      return {
        _success: false,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const possibleLocators = [`#iframe-window`, `body > header > h1`];

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
