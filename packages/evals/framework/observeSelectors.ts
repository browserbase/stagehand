import type { Page } from "@browserbasehq/stagehand";

/**
 * Checks whether an observed selector and any expected selector identify the same element.
 * Selectors may be CSS or XPath (bare `/...`/`(...)` or `xpath=`-prefixed).
 *
 * Main-frame only: `page.evaluate` runs in the top document, so selectors
 * pointing inside iframes do not resolve.
 */
export async function selectorsResolveToSameElement(
  page: Page,
  observedSelector: string,
  candidateSelectors: string[],
): Promise<boolean> {
  return page.evaluate(
    ({
      observedSelector,
      candidateSelectors,
    }: {
      observedSelector: string;
      candidateSelectors: string[];
    }) => {
      const resolve = (selector: string): Element | null => {
        try {
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
        } catch {
          return null;
        }
      };

      const observed = resolve(observedSelector);
      return observed
        ? candidateSelectors.some((candidate) => resolve(candidate) === observed)
        : false;
    },
    { observedSelector, candidateSelectors },
  );
}
