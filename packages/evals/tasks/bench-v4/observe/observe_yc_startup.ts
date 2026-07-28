import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "observe_yc_startup" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://www.ycombinator.com/companies", {
        waitUntil: "networkidle",
      });

      const observations = await stagehand.observe(
        "Click the container element that holds links to each of the startup companies. The companies each have a name, a description, and a link to their website.",
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
        `div._rightCol_18olp_594`,
        `div._section_18olp_165._results_18olp_345`,
      ];

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page: resolve the observed selector and each
      // candidate selector and compare element references.
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
