import { generateXPathsForElement as generateXPaths } from "./xpathUtils";
import {
  canElementScroll,
  getNodeFromXpath,
  waitForElementScrollEnd,
} from "./utils";

/**
 * Finds and returns a list of scrollable elements on the page,
 * ordered from the element with the largest scrollHeight to the smallest.
 *
 * @param topN Optional maximum number of scrollable elements to return.
 *             If not provided, all found scrollable elements are returned.
 * @returns An array of HTMLElements sorted by descending scrollHeight.
 */
export function getScrollableElements(topN?: number): HTMLElement[] {
  // Get the root <html> element
  const docEl = document.documentElement;

  // 1) Initialize an array to hold all scrollable elements.
  //    Always include the root <html> element as a fallback.
  const scrollableElements: HTMLElement[] = [docEl];

  // 2) Scan all elements to find potential scrollable containers.
  //    A candidate must have a scrollable overflow style and extra scrollable content.
  const allElements = document.querySelectorAll<HTMLElement>("*");
  for (const elem of allElements) {
    const style = window.getComputedStyle(elem);
    const overflowY = style.overflowY;

    const isPotentiallyScrollable =
      overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";

    if (isPotentiallyScrollable) {
      const candidateScrollDiff = elem.scrollHeight - elem.clientHeight;
      // Only consider this element if it actually has extra scrollable content
      // and it can truly scroll.
      if (candidateScrollDiff > 0 && canElementScroll(elem)) {
        scrollableElements.push(elem);
      }
    }
  }

  // 3) Sort the scrollable elements from largest scrollHeight to smallest.
  scrollableElements.sort((a, b) => b.scrollHeight - a.scrollHeight);

  // 4) If a topN limit is specified, return only the first topN elements.
  if (topN !== undefined) {
    return scrollableElements.slice(0, topN);
  }

  // Return all found scrollable elements if no limit is provided.
  return scrollableElements;
}

/**
 * Calls getScrollableElements, then for each element calls generateXPaths,
 * and returns the first XPath for each.
 *
 * @param topN (optional) integer limit on how many scrollable elements to process
 * @returns string[] list of XPaths (1 for each scrollable element)
 */
export async function getScrollableElementXpaths(
  topN?: number,
): Promise<string[]> {
  const scrollableElems = getScrollableElements(topN);
  const xpaths = [];
  for (const elem of scrollableElems) {
    const allXPaths = await generateXPaths(elem);
    const firstXPath = allXPaths?.[0] || "";
    xpaths.push(firstXPath);
  }
  return xpaths;
}

(() => {
  // Map <host ➜ shadowRoot> for every root created in closed mode
  const closedRoots: WeakMap<Element, ShadowRoot> = new WeakMap();

  // Preserve the original method
  const nativeAttachShadow = Element.prototype.attachShadow;

  // Intercept *before any page script runs*
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const root = nativeAttachShadow.call(this, init);
    if (init.mode === "closed") closedRoots.set(this, root);
    return root;
  };

  interface StagehandBackdoor {
    /** Get the real ShadowRoot (undefined if host has none / is open) */
    getClosedRoot(host: Element): ShadowRoot | undefined;

    /** CSS‑selector search inside that root */
    queryClosed(host: Element, selector: string): Element[];

    /** XPath search inside that root (relative XPath supported) */
    xpathClosed(host: Element, xpath: string): Node[];
  }

  const backdoor: StagehandBackdoor = {
    getClosedRoot: (host) => closedRoots.get(host),

    queryClosed: (host, selector) => {
      const root = closedRoots.get(host);
      return root ? Array.from(root.querySelectorAll(selector)) : [];
    },

    xpathClosed: (host, xp) => {
      const root = closedRoots.get(host);
      if (!root) return [];
      const it = document.evaluate(
        xp,
        root,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      const out: Node[] = [];
      for (let i = 0; i < it.snapshotLength; ++i) {
        const n = it.snapshotItem(i);
        if (n) out.push(n);
      }
      return out;
    },
  };

  if (!("__stagehand__" in window)) {
    Object.defineProperty(window, "__stagehand__", {
      value: backdoor,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
})();

window.getScrollableElementXpaths = getScrollableElementXpaths;
window.getNodeFromXpath = getNodeFromXpath;
window.waitForElementScrollEnd = waitForElementScrollEnd;
