import { resolveXPathAtIndex } from "./xpathResolver.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

const parseTargetIndex = (value: unknown): number => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
};

export const queryLegacyCssSelector = (
  selector: string,
  { limit = Infinity, pierceShadow = true }: { limit?: number; pierceShadow?: boolean } = {},
): Element[] => {
  if (!selector) return [];
  const seenRoots = new WeakSet<Node>();
  const seenElements = new Set<Element>();
  const results: Element[] = [];
  const queue: Array<Document | ShadowRoot> = [document];

  const visit = (root: Document | ShadowRoot): void => {
    if (!root || seenRoots.has(root) || results.length >= limit) return;
    seenRoots.add(root);

    try {
      const matches = root.querySelectorAll(selector);
      for (const element of matches) {
        if (seenElements.has(element)) continue;
        seenElements.add(element);
        results.push(element);
        if (results.length >= limit) return;
      }
    } catch {
      // ignore querySelectorAll issues
    }

    if (!pierceShadow) return;
    try {
      const ownerDocument =
        root instanceof Document ? root : (root.host?.ownerDocument ?? document);
      const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        const shadowRoot = getOpenOrClosedShadowRoot(node);
        if (shadowRoot) queue.push(shadowRoot);
      }
    } catch {
      // ignore traversal issues
    }
  };

  while (queue.length && results.length < limit) {
    const next = queue.shift();
    if (next) visit(next);
  }

  return results;
};

export function resolveCssSelector(selectorRaw: string, targetIndexRaw?: number): Element | null {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return null;

  const targetIndex = parseTargetIndex(targetIndexRaw);
  const matches = queryLegacyCssSelector(selector, { limit: targetIndex + 1 });
  return matches[targetIndex] ?? null;
}

export function resolveTextSelector(rawNeedle: string, targetIndexRaw?: number): Element | null {
  return queryLegacyTextSelector(rawNeedle)[parseTargetIndex(targetIndexRaw)] ?? null;
}

/** Legacy text= matching, retained for existing selectors used as a builder's root. */
export function queryLegacyTextSelector(
  rawNeedle: string,
  { pierceShadow = true }: { pierceShadow?: boolean } = {},
): Element[] {
  const needle = String(rawNeedle ?? "");
  if (!needle) return [];
  const needleLc = needle.toLowerCase();

  const skipTags = new Set([
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "NOSCRIPT",
    "HEAD",
    "TITLE",
    "LINK",
    "META",
    "HTML",
    "BODY",
  ]);

  const shouldSkip = (node: Element | null | undefined): boolean => {
    if (!node) return false;
    const tag = node.tagName?.toUpperCase() ?? "";
    return skipTags.has(tag);
  };

  const extractText = (node: Element): string => {
    try {
      if (shouldSkip(node)) return "";
      const inner = (node as HTMLElement).innerText;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {
      // ignore
    }
    try {
      const text = node.textContent;
      if (typeof text === "string") return text.trim();
    } catch {
      // ignore
    }
    return "";
  };

  const matches = (node: Element): boolean => {
    const text = extractText(node);
    return !!text && text.toLowerCase().includes(needleLc);
  };

  const seen = new WeakSet<Node>();
  const queue: Node[] = [];
  const matchesList: Array<{
    element: Element;
    tag: string;
    id: string;
    className: string;
    text: string;
  }> = [];

  const enqueue = (node: Node | null | undefined) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    queue.push(node);
  };

  const walkerFor = (root: Node): TreeWalker | null => {
    try {
      const doc = root instanceof Document ? root : ((root as Element)?.ownerDocument ?? document);
      return doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    } catch {
      return null;
    }
  };

  enqueue(document);

  while (queue.length) {
    const root = queue.shift();
    if (!root) continue;

    if (root instanceof Element && matches(root)) {
      matchesList.push({
        element: root,
        tag: root.tagName ?? "",
        id: root.id ?? "",
        className: (root as HTMLElement).className ?? "",
        text: extractText(root),
      });
    }

    const walker = walkerFor(root);
    if (!walker) continue;

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof Element)) continue;

      if (matches(node)) {
        matchesList.push({
          element: node,
          tag: node.tagName ?? "",
          id: node.id ?? "",
          className: (node as HTMLElement).className ?? "",
          text: extractText(node),
        });
      }

      const shadowRoot = pierceShadow ? getOpenOrClosedShadowRoot(node) : null;
      if (shadowRoot) enqueue(shadowRoot);
    }
  }

  const innermost: typeof matchesList = [];
  for (const item of matchesList) {
    const el = item.element;
    let skip = false;
    for (const other of matchesList) {
      if (item === other) continue;
      try {
        if (el.contains(other.element)) {
          skip = true;
          break;
        }
      } catch {
        // ignore containment errors
      }
    }
    if (!skip) {
      innermost.push(item);
    }
  }

  return innermost.map((item) => item.element);
}

export function resolveXPathMainWorld(rawXp: string, targetIndexRaw?: number): Element | null {
  const targetIndex = parseTargetIndex(targetIndexRaw);
  return resolveXPathAtIndex(rawXp, targetIndex, { pierceShadow: true });
}
