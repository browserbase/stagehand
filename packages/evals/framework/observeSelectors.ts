/**
 * Shared in-page selector-resolution and element-identity helper for observe
 * tasks. It resolves observed and known-good selectors in the main document
 * and compares the resulting element references.
 *
 * Main-frame only: `page.evaluate` runs in the top document, so selectors
 * pointing inside iframes do not resolve.
 */
import type { Page } from "@browserbasehq/stagehand";

/**
 * Resolves `observedSelector` and each of `candidateSelectors` in the page's
 * main document and returns the first candidate that resolves to the same
 * element as the observed selector, or `null` when none does (or when the
 * observed selector itself does not resolve).
 *
 * Selectors may be CSS or XPath (bare `/...`/`(...)` or `xpath=`-prefixed).
 */
export async function findMatchingSelector(
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
