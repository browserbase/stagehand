import { resolveXPathAtIndex } from "./xpathResolver.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";
import { collectInnermostTextMatches } from "./textMatches.js";

const parseTargetIndex = (value: unknown): number => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
};

const collectCssMatches = (selector: string, limit: number): Element[] => {
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
  const matches = collectCssMatches(selector, targetIndex + 1);
  return matches[targetIndex] ?? null;
}

export function resolveTextSelector(rawNeedle: string, targetIndexRaw?: number): Element | null {
  const needle = String(rawNeedle ?? "");
  if (!needle) return null;
  const targetIndex = parseTargetIndex(targetIndexRaw);
  const matches = collectInnermostTextMatches(needle, targetIndex + 1);
  return matches[targetIndex] ?? null;
}

export function resolveXPathMainWorld(rawXp: string, targetIndexRaw?: number): Element | null {
  const targetIndex = parseTargetIndex(targetIndexRaw);
  return resolveXPathAtIndex(rawXp, targetIndex, { pierceShadow: true });
}
