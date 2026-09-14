import type { Page } from "@browserbasehq/stagehand";

/**
 * Returns the first candidate selector that resolves to the same DOM element as
 * `observedSelector`, or null if none do.
 *
 * Observe benchmarks can't compare selector strings — `xpath=//button[@id="go"]`,
 * `#go`, and `/html/body/div/button` may all address the same element. So both
 * sides are resolved to elements inside the page and compared by identity.
 *
 * The resolver is a string expression rather than a serialized function:
 * `page.evaluate` ships a function's compiled source into the page, and
 * bundlers that preserve function names (tsx/esbuild `keepNames`) wrap inner
 * functions in a module-scope `__name` helper that does not exist there —
 * every call then throws "Uncaught" before comparing anything. A string
 * expression bypasses serialization entirely, so it runs identically under
 * tsx, the built CLI, and CI.
 *
 * Main-frame only: `page.evaluate` runs in the top document, so selectors
 * pointing inside iframes do not resolve.
 */
export async function matchingSelector(
  page: Page,
  observedSelector: string,
  candidateSelectors: string[],
): Promise<string | null> {
  const expression = `(() => {
    const observedSelector = ${JSON.stringify(observedSelector)};
    const candidateSelectors = ${JSON.stringify(candidateSelectors)};
    const resolve = (selector) => {
      const raw = selector.startsWith("xpath=") ? selector.slice("xpath=".length) : selector;
      if (raw.startsWith("/") || raw.startsWith("(")) {
        const result = document.evaluate(raw, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue;
      }
      return document.querySelector(raw);
    };
    const observed = resolve(observedSelector);
    if (!observed) return null;
    for (const candidate of candidateSelectors) {
      if (resolve(candidate) === observed) return candidate;
    }
    return null;
  })()`;
  return (await page.evaluate(expression)) as string | null;
}
