import type { Page } from "@browserbasehq/stagehand";

/**
 * Returns the first candidate selector that resolves to the same DOM element as
 * `observedSelector`, or null if none do.
 *
 * Observe benchmarks can't compare selector strings — `xpath=//button[@id="go"]`,
 * `#go`, and `/html/body/div/button` may all address the same element. So both
 * sides are resolved to elements inside the page and compared by identity.
 *
 * The resolver has to be inlined here rather than imported: `page.evaluate`
 * serializes the callback and runs it in the browser, where module imports do
 * not exist. Sharing the whole evaluate call is what keeps XPath/CSS handling
 * in one place for every observe task.
 *
 * Main-frame only: `page.evaluate` runs in the top document, so selectors
 * pointing inside iframes do not resolve.
 */
export async function matchingSelector(
  page: Page,
  observedSelector: string,
  candidateSelectors: string[],
): Promise<string | null> {
  return page.evaluate(
    ({
      observedSelector,
      candidateSelectors,
    }: {
      observedSelector: string;
      candidateSelectors: string[];
    }) => {
      const resolve = (selector: string): Element | null => {
        const raw = selector.startsWith("xpath=") ? selector.slice("xpath=".length) : selector;
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
    { observedSelector, candidateSelectors },
  );
}
