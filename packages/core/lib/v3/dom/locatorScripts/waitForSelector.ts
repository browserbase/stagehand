/**
 * waitForSelector - Waits for an element matching a selector to reach a specific state.
 * Supports both CSS selectors and XPath expressions.
 * Uses MutationObserver for efficiency and integrates with the V3 piercer for closed shadow roots.
 *
 * NOTE: This function runs inside the page context. Keep it dependency-free
 * and resilient to exceptions.
 */

import { resolveXPathFirst } from "./xpathResolver.js";

type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

/**
 * Check if a selector is an XPath expression.
 */
const isXPath = (selector: string): boolean => {
  return selector.startsWith("xpath=") || selector.startsWith("/");
};

/**
 * Get closed shadow root via the V3 piercer if available.
 */
const getClosedRoot = (element: Element): ShadowRoot | null => {
  try {
    const backdoor = window.__stagehandV3__;
    if (backdoor && typeof backdoor.getClosedRoot === "function") {
      return backdoor.getClosedRoot(element) ?? null;
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Get shadow root (open or closed via piercer).
 */
const getShadowRoot = (element: Element): ShadowRoot | null => {
  // First try open shadow root
  if (element.shadowRoot) return element.shadowRoot;
  // Then try closed shadow root via piercer
  return getClosedRoot(element);
};

/**
 * Deep querySelector that pierces shadow DOM (both open and closed via piercer).
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
      const walker = ownerDoc.createTreeWalker(
        currentRoot,
        NodeFilter.SHOW_ELEMENT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        const shadowRoot = getShadowRoot(node);
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
const deepXPathQuery = (
  xpath: string,
  pierceShadow: boolean,
): Element | null => {
  return resolveXPathFirst(xpath, { pierceShadow });
};

/**
 * Find element by selector (CSS or XPath) with optional shadow DOM piercing.
 */
const findElement = (
  selector: string,
  pierceShadow: boolean,
): Element | null => {
  if (isXPath(selector)) {
    return deepXPathQuery(selector, pierceShadow);
  }
  return deepQuerySelector(document, selector, pierceShadow);
};

/**
 * Check if element matches the desired state.
 */
const checkState = (
  el: Element | null,
  state: WaitForSelectorState,
): boolean => {
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
): void => {
  const seenRoots = new WeakSet<Node>();

  const observeShadowRoots = (node: Element): void => {
    const shadowRoot = getShadowRoot(node);
    if (shadowRoot && !seenRoots.has(shadowRoot)) {
      seenRoots.add(shadowRoot);
      const shadowObserver = new MutationObserver(callback);
      shadowObserver.observe(shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "disabled"],
      });
      observers.push(shadowObserver);

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
  if (root) {
    observeShadowRoots(root);
  }
};

/**
 * Wait for an element matching the selector to reach the specified state.
 * Supports both CSS selectors and XPath expressions (prefix with "xpath=" or start with "/").
 *
 * @param selectorRaw - CSS selector or XPath expression to wait for
 * @param stateRaw - Element state: 'attached' | 'detached' | 'visible' | 'hidden'
 * @param timeoutRaw - Maximum time to wait in milliseconds
 * @param pierceShadowRaw - Whether to search inside shadow DOM
 * @returns Promise that resolves to true when condition is met, or rejects on timeout
 */
export function waitForSelector(
  selectorRaw: string,
  stateRaw?: string,
  timeoutRaw?: number,
  pierceShadowRaw?: boolean,
): Promise<boolean> {
  const selector = String(selectorRaw ?? "").trim();
  const state =
    (String(stateRaw ?? "visible") as WaitForSelectorState) || "visible";
  const timeout =
    typeof timeoutRaw === "number" && timeoutRaw > 0 ? timeoutRaw : 30000;
  const pierceShadow = pierceShadowRaw !== false;

  return new Promise<boolean>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let domReadyHandler: (() => void) | null = null;
    let settled = false;
    const clearTimer = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Check immediately
    const el = findElement(selector, pierceShadow);
    if (checkState(el, state)) {
      settled = true;
      resolve(true);
      return;
    }

    const observers: MutationObserver[] = [];

    const cleanup = (): void => {
      for (const obs of observers) {
        obs.disconnect();
      }
      if (domReadyHandler) {
        document.removeEventListener("DOMContentLoaded", domReadyHandler);
        domReadyHandler = null;
      }
    };

    const check = (): void => {
      if (settled) return;
      const el = findElement(selector, pierceShadow);
      if (checkState(el, state)) {
        settled = true;
        clearTimer();
        cleanup();
        resolve(true);
      }
    };

    // Handle case where document.body is not ready yet
    const observeRoot = document.body || document.documentElement;
    if (!observeRoot) {
      domReadyHandler = (): void => {
        document.removeEventListener("DOMContentLoaded", domReadyHandler!);
        domReadyHandler = null;
        check();
        setupObservers();
      };
      document.addEventListener("DOMContentLoaded", domReadyHandler);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimer();
        cleanup();
        reject(
          new Error(
            `waitForSelector: Timeout ${timeout}ms exceeded waiting for "${selector}" to be ${state}`,
          ),
        );
      }, timeout);
      return;
    }

    const setupObservers = (): void => {
      const root = document.body || document.documentElement;
      if (!root) return;

      // Main document observer
      const mainObserver = new MutationObserver(check);
      mainObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "disabled"],
      });
      observers.push(mainObserver);

      // Shadow DOM observers (if piercing)
      if (pierceShadow) {
        setupShadowObservers(check, observers);
      }
    };

    setupObservers();

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimer();
      cleanup();
      reject(
        new Error(
          `waitForSelector: Timeout ${timeout}ms exceeded waiting for "${selector}" to be ${state}`,
        ),
      );
    }, timeout);
  });
}
