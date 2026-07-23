import { defineBenchV4Task } from "../../../framework/defineTask.js";
import { type ObservedAction } from "../../../framework/observeReplay.js";

export default defineBenchV4Task(
  { name: "observe_iframes2" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://iframetester.com/?url=https://shopify.com");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let observations: ObservedAction[];
      try {
        observations = await stagehand.observe(
          "find the main header of the page",
        );
      } catch (err) {
        return {
          _success: false,
          message: err instanceof Error ? err.message : String(err),
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

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page. Both candidate selectors live in the main
      // frame (the shopify iframe is cross-origin and unreachable from the
      // main document either way): an observed selector that pierces into
      // the iframe never had a backendNodeId equal to either main-frame
      // candidate in v3 (no match), and here it simply fails to resolve in
      // the main document (no match) — the pass criterion is preserved.
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
