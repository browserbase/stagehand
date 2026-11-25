import { resolveXPathFirst } from "./xpathResolver.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

const isXPath = (selector: string): boolean => {
  return selector.startsWith("xpath=") || selector.startsWith("/");
};

const deepQuerySelector = (
  root: Document | ShadowRoot,
  selector: string,
  pierceShadow: boolean,
): Element | null => {
  try {
    const el = root.querySelector(selector);
    if (el) return el;
  } catch {}

  if (!pierceShadow) return null;

  const seenRoots = new WeakSet<Node>();
  const queue: Array<Document | ShadowRoot> = [root];

  while (queue.length > 0) {
    const currentRoot = queue.shift();
    if (!currentRoot || seenRoots.has(currentRoot)) continue;
    seenRoots.add(currentRoot);

    try {
      const found = currentRoot.querySelector(selector);
      if (found) return found;
    } catch {}

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
    } catch {}
  }

  return null;
};

const deepXPathQuery = (xpath: string, pierceShadow: boolean): Element | null => {
  return resolveXPathFirst(xpath, { pierceShadow });
};

const findElement = (selector: string, pierceShadow: boolean): Element | null => {
  if (isXPath(selector)) {
    return deepXPathQuery(selector, pierceShadow);
  }
  return deepQuerySelector(document, selector, pierceShadow);
};

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

      for (const child of Array.from(shadowRoot.children)) {
        observeShadowRoots(child);
      }
    }

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
  void promise.catch(() => {});
  return { promise, dispose: () => dispose() };
}
