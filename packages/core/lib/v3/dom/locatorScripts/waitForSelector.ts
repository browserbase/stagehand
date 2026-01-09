/**
 * waitForSelector - Waits for an element matching a selector to reach a specific state.
 * Supports both CSS selectors and XPath expressions.
 * Uses MutationObserver for efficiency and integrates with the V3 piercer for closed shadow roots.
 *
 * NOTE: This function runs inside the page context. Keep it dependency-free
 * and resilient to exceptions.
 */

type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

/**
 * Check if a selector is an XPath expression.
 */
const isXPath = (selector: string): boolean => {
  return selector.startsWith("xpath=") || selector.startsWith("/");
};

/**
 * Normalize XPath by removing "xpath=" prefix if present.
 */
const normalizeXPath = (selector: string): string => {
  if (selector.startsWith("xpath=")) {
    return selector.slice(6).trim();
  }
  return selector;
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
 * Parse XPath into steps for composed tree traversal.
 */
type XPathStep = {
  axis: "child" | "desc";
  tag: string;
  index: number | null;
  attrName: string | null;
  attrValue: string | null;
};

const parseXPathSteps = (xpath: string): XPathStep[] => {
  const path = xpath.replace(/^xpath=/i, "");
  const steps: XPathStep[] = [];
  let i = 0;

  while (i < path.length) {
    let axis: "child" | "desc" = "child";
    if (path.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (path[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    // Handle brackets to avoid splitting on `/` inside predicates
    let bracketDepth = 0;
    while (i < path.length) {
      if (path[i] === "[") bracketDepth++;
      else if (path[i] === "]") bracketDepth--;
      else if (path[i] === "/" && bracketDepth === 0) break;
      i += 1;
    }
    const rawStep = path.slice(start, i).trim();
    if (!rawStep) continue;

    // Parse step: tagName[@attr='value'][index]
    // Match tag name (everything before first [)
    const tagMatch = rawStep.match(/^([^[]+)/);
    const tagRaw = (tagMatch?.[1] ?? "*").trim();
    const tag = tagRaw === "" ? "*" : tagRaw.toLowerCase();

    // Match index predicate [N]
    const indexMatch = rawStep.match(/\[(\d+)\]/);
    const index = indexMatch ? Math.max(1, Number(indexMatch[1])) : null;

    // Match attribute predicate [@attr='value'] or [@attr="value"]
    const attrMatch = rawStep.match(
      /\[@([a-zA-Z_][\w-]*)\s*=\s*['"]([^'"]*)['"]\]/,
    );
    const attrName = attrMatch ? attrMatch[1] : null;
    const attrValue = attrMatch ? attrMatch[2] : null;

    steps.push({ axis, tag, index, attrName, attrValue });
  }

  return steps;
};

/**
 * Get composed children of a node (including shadow root children).
 */
const composedChildren = (node: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  if (!node) return out;

  if (node instanceof Document) {
    if (node.documentElement) out.push(node.documentElement);
    return out;
  }

  if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
    out.push(...Array.from(node.children ?? []));
    return out;
  }

  if (node instanceof Element) {
    out.push(...Array.from(node.children ?? []));
    const open = node.shadowRoot;
    if (open) out.push(...Array.from(open.children ?? []));
    const closed = getClosedRoot(node);
    if (closed) out.push(...Array.from(closed.children ?? []));
    return out;
  }

  return out;
};

/**
 * Get all composed descendants of a node.
 */
const composedDescendants = (node: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const queue = [...composedChildren(node)];

  while (queue.length) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    queue.push(...composedChildren(next));
  }

  return out;
};

/**
 * Resolve XPath with shadow DOM piercing support.
 */
const deepXPathQuery = (
  xpath: string,
  pierceShadow: boolean,
): Element | null => {
  const xp = normalizeXPath(xpath);
  if (!xp) return null;

  const backdoor = window.__stagehandV3__;

  // Try fast path via piercer's resolveSimpleXPath first (handles shadow DOM)
  if (pierceShadow) {
    try {
      if (backdoor && typeof backdoor.resolveSimpleXPath === "function") {
        const fast = backdoor.resolveSimpleXPath(xp);
        if (fast) return fast;
      }
    } catch {
      // ignore and continue
    }
  }

  // Try native document.evaluate (works for light DOM elements)
  try {
    const result = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue as Element | null;
    if (result) return result;
  } catch {
    // XPath syntax error or evaluation failed, continue to fallback
  }

  // If not piercing shadow DOM, we're done
  if (!pierceShadow) {
    return null;
  }

  // Parse XPath into steps for composed tree traversal (shadow DOM piercing)
  const steps = parseXPathSteps(xp);
  if (!steps.length) {
    return null;
  }

  // Traverse composed tree following XPath steps
  let current: Array<Document | Element | ShadowRoot | DocumentFragment> = [
    document,
  ];

  for (const step of steps) {
    const next: Element[] = [];
    const seen = new Set<Element>();

    for (const root of current) {
      if (!root) continue;
      const pool =
        step.axis === "child"
          ? composedChildren(root)
          : composedDescendants(root);
      if (!pool.length) continue;

      // Filter by tag name
      let matches = pool.filter((candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (step.tag === "*") return true;
        return candidate.localName === step.tag;
      });

      // Filter by attribute predicate if present
      if (step.attrName != null && step.attrValue != null) {
        matches = matches.filter((candidate) => {
          const attrVal = candidate.getAttribute(step.attrName!);
          return attrVal === step.attrValue;
        });
      }

      if (step.index != null) {
        const idx = step.index - 1;
        const chosen = idx >= 0 && idx < matches.length ? matches[idx] : null;
        if (chosen && !seen.has(chosen)) {
          seen.add(chosen);
          next.push(chosen);
        }
      } else {
        for (const candidate of matches) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            next.push(candidate);
          }
        }
      }
    }

    if (!next.length) return null;
    current = next;
  }

  return (current[0] as Element) ?? null;
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
