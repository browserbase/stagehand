/**
 * waitForSelector - Waits for an element matching a selector to reach a specific state.
 * Supports both CSS selectors and XPath expressions.
 * Uses MutationObserver for efficiency and the extension DOM API for closed shadow roots.
 *
 * NOTE: This function runs inside the page context. Keep it dependency-free
 * and resilient to exceptions.
 */

import { resolveXPathFirst } from "./xpathResolver.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

/**
 * Check if a selector is an XPath expression.
 */
const isXPath = (selector: string): boolean => {
  return selector.startsWith("xpath=") || selector.startsWith("/");
};

/**
 * Deep querySelector that pierces both open and closed shadow DOM.
 */
const deepQuerySelector = (
  root: Document | ShadowRoot,
  selector: string,
  pierceShadow: boolean,
): Element | null => {
  // Try regular querySelector first
  try {
    const el = root.querySelector(selector);
    if (el) return el;
  } catch {
    // ignore query errors
  }

  if (!pierceShadow) return null;

  // BFS queue to search all shadow roots (open and closed)
  const seenRoots = new WeakSet<Node>();
  const queue: Array<Document | ShadowRoot> = [root];

  while (queue.length > 0) {
    const currentRoot = queue.shift();
    if (!currentRoot || seenRoots.has(currentRoot)) continue;
    seenRoots.add(currentRoot);

    // Try querySelector on this root
    try {
      const found = currentRoot.querySelector(selector);
      if (found) return found;
    } catch {
      // ignore query errors
    }

    // Walk all elements in this root to find shadow hosts
    try {
      const ownerDoc =
        currentRoot instanceof Document
          ? currentRoot
          : (currentRoot.host?.ownerDocument ?? document);
      const walker = ownerDoc.createTreeWalker(currentRoot, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        const shadowRoot = getOpenOrClosedShadowRoot(node);
        if (shadowRoot && !seenRoots.has(shadowRoot)) {
          queue.push(shadowRoot);
        }
      }
    } catch {
      // ignore traversal errors
    }
  }

  return null;
};

/**
 * Resolve XPath with shadow DOM piercing support.
 */
const deepXPathQuery = (xpath: string, pierceShadow: boolean): Element | null => {
  return resolveXPathFirst(xpath, { pierceShadow });
};

/**
 * Find element by selector (CSS or XPath) with optional shadow DOM piercing.
 */
const findElement = (selector: string, pierceShadow: boolean): Element | null => {
  if (isXPath(selector)) {
    return deepXPathQuery(selector, pierceShadow);
  }
  return deepQuerySelector(document, selector, pierceShadow);
};

/**
 * Check if element matches the desired state.
 */
const checkState = (el: Element | null, state: WaitForSelectorState): boolean => {
  if (state === "detached") return el === null;
  if (state === "attached") return el !== null;
  if (el === null) return false;

  if (state === "hidden") {
    try {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        rect.width === 0 ||
        rect.height === 0
      );
    } catch {
      return false;
    }
  }

  // state === "visible"
  try {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  } catch {
    return false;
  }
};

/**
 * Set up MutationObservers on all shadow roots to detect changes.
 */
const setupShadowObservers = (
  callback: () => void,
  observers: MutationObserver[],
  isSettled: () => boolean,
): (() => void) => {
  const seenRoots = new WeakSet<Node>();

  const observeShadowRoots = (node: Element): void => {
    const shadowRoot = getOpenOrClosedShadowRoot(node);
    if (shadowRoot && !seenRoots.has(shadowRoot)) {
      seenRoots.add(shadowRoot);
      const shadowObserver = new MutationObserver(() => {
        callback();
        scan();
      });
      observers.push(shadowObserver);
      shadowObserver.observe(shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "disabled"],
      });

      // Recurse into shadow root children
      for (const child of Array.from(shadowRoot.children)) {
        observeShadowRoots(child);
      }
    }

    // Recurse into regular children
    for (const child of Array.from(node.children)) {
      observeShadowRoots(child);
    }
  };

  const root = document.documentElement || document.body;
  const scan = (): void => {
    if (!isSettled() && root) observeShadowRoots(root);
  };
  scan();
  return scan;
};

/**
 * Wait for an element matching the selector to reach the specified state.
 * Supports both CSS selectors and XPath expressions (prefix with "xpath=" or start with "/").
 *
 * @param selectorRaw - CSS selector or XPath expression to wait for
 * @param stateRaw - Element state: 'attached' | 'detached' | 'visible' | 'hidden'
 * @param timeoutRaw - Maximum time to wait in milliseconds; defaults to 30,000, zero is unlimited
 * @param pierceShadowRaw - Whether to search inside shadow DOM
 * @returns A disposable handle whose promise resolves when the condition is met
 */
export function createSelectorWait(
  selectorRaw: string,
  stateRaw?: string,
  timeoutRaw?: number,
  pierceShadowRaw?: boolean,
): { promise: Promise<boolean>; dispose: () => void } {
  const selector = String(selectorRaw ?? "").trim();
  const state = (String(stateRaw ?? "visible") as WaitForSelectorState) || "visible";
  const timeout = typeof timeoutRaw === "number" && timeoutRaw >= 0 ? timeoutRaw : 30000;
  const pierceShadow = pierceShadowRaw !== false;
  let dispose = () => {};

  const promise = new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let shadowScanInterval: ReturnType<typeof setInterval> | undefined;
    let domReadyHandler: (() => void) | undefined;
    let rescanShadowRoots: (() => void) | undefined;
    const observers: MutationObserver[] = [];

    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(shadowScanInterval);
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
      rescanShadowRoots = undefined;
      if (domReadyHandler) {
        document.removeEventListener("DOMContentLoaded", domReadyHandler);
        domReadyHandler = undefined;
      }
      if (error) reject(error);
      else resolve(true);
    };
    dispose = () => settle(new Error("Selector wait disposed"));

    const check = (): void => {
      if (settled) return;
      try {
        if (checkState(findElement(selector, pierceShadow), state)) settle();
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const setupObservers = (): void => {
      if (settled) return;
      const root = document.body || document.documentElement;
      if (!root) return;
      try {
        const mainObserver = new MutationObserver(() => {
          check();
          rescanShadowRoots?.();
        });
        observers.push(mainObserver);
        mainObserver.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "hidden", "disabled"],
        });
        if (pierceShadow) {
          rescanShadowRoots = setupShadowObservers(check, observers, () => settled);
          shadowScanInterval = setInterval(() => {
            rescanShadowRoots?.();
            check();
          }, 100);
        }
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    };

    check();
    if (settled) return;
    if (document.body || document.documentElement) {
      setupObservers();
    } else {
      domReadyHandler = () => {
        if (settled) return;
        document.removeEventListener("DOMContentLoaded", domReadyHandler!);
        domReadyHandler = undefined;
        check();
        setupObservers();
      };
      document.addEventListener("DOMContentLoaded", domReadyHandler);
    }
    if (!settled && timeout > 0) {
      timeoutId = setTimeout(
        () =>
          settle(
            new Error(
              `waitForSelector: Timeout ${timeout}ms exceeded waiting for "${selector}" to be ${state}`,
            ),
          ),
        timeout,
      );
    }
  });
  // Installation and awaiting use separate CDP commands; observe an early rejection.
  void promise.catch(() => {});
  return { promise, dispose: () => dispose() };
}
