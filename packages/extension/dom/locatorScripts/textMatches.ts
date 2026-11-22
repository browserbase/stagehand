import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

const SKIP_TAGS = new Set([
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

const shouldSkip = (element: Element): boolean => {
  try {
    return SKIP_TAGS.has(element.tagName?.toUpperCase() ?? "");
  } catch {
    return false;
  }
};

const textContentOf = (element: Element): string => {
  try {
    const text = element.textContent;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
};

/**
 * Prefer trimmed innerText, then trimmed textContent.
 * Skipped tags contribute no text, but their descendants are still walked.
 */
const extractText = (element: Element): string => {
  try {
    if (shouldSkip(element)) return "";
    const inner = (element as HTMLElement).innerText;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  } catch {
    // ignore
  }
  return textContentOf(element);
};

const isLightLeaf = (element: Element): boolean => {
  try {
    // An open shadow host has no light children but innerText includes shadow text.
    return element.childElementCount === 0 && !element.shadowRoot;
  } catch {
    return false;
  }
};

// Whitespace that innerText would collapse or normalize: any run of two or more
// whitespace characters, or any whitespace character other than a plain space.
const COLLAPSIBLE_WHITESPACE = /\s\s|[^\S ]/;

/**
 * Text used to decide a candidate. A leaf whose text has nothing to collapse skips layout,
 * because innerText and textContent agree there. Everything else stays layout-aware.
 */
export function textUsedForMatch(element: Element): string {
  if (shouldSkip(element)) return "";
  if (isLightLeaf(element)) {
    const text = textContentOf(element);
    if (!COLLAPSIBLE_WHITESPACE.test(text)) return text;
  }
  return extractText(element);
}

const includesNeedle = (element: Element, needleLc: string): boolean => {
  const text = textUsedForMatch(element);
  return text.length > 0 && text.toLowerCase().includes(needleLc);
};

const ownerDocumentOf = (root: ParentNode): Document => {
  if (root instanceof Document) return root;
  if (root instanceof ShadowRoot) return root.host?.ownerDocument ?? document;
  return root.ownerDocument ?? document;
};

/**
 * Innermost light-DOM matches in document order.
 *
 * A light-DOM descendant that matches suppresses its ancestors. A shadow match does not:
 * element.contains does not cross a shadow boundary. Each tree is enumerated with a
 * TreeWalker so closed shadow roots from getOpenOrClosedShadowRoot stay readable.
 * Shadow roots are queued in document order, then searched breadth-first after the tree
 * that contains those hosts. Nested shadow roots therefore run after later sibling hosts.
 *
 * maxMatches stops once that many innermost elements have been emitted. Later siblings
 * and not-yet-searched shadow roots sort after those elements.
 */
export function collectInnermostTextMatches(rawNeedle: string, maxMatches = Infinity): Element[] {
  const needle = String(rawNeedle ?? "");
  if (!needle || maxMatches <= 0) return [];
  const needleLc = needle.toLowerCase();
  const results: Element[] = [];
  const shadowRoots: ShadowRoot[] = [];
  const seenShadows = new WeakSet<ShadowRoot>();

  const queueShadow = (element: Element): void => {
    try {
      const shadow = getOpenOrClosedShadowRoot(element);
      if (!shadow || seenShadows.has(shadow)) return;
      seenShadows.add(shadow);
      shadowRoots.push(shadow);
    } catch {
      // ignore shadow lookup errors
    }
  };

  const visitTree = (root: ParentNode): void => {
    const elements: Element[] = [];
    try {
      const walker = ownerDocumentOf(root).createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        elements.push(node);
        queueShadow(node);
      }
    } catch {
      return;
    }

    const childrenByParent = new Map<Node, Element[]>();
    for (const element of elements) {
      const parent = element.parentNode;
      if (!parent) continue;
      const siblings = childrenByParent.get(parent);
      if (siblings) siblings.push(element);
      else childrenByParent.set(parent, [element]);
    }

    const visit = (element: Element): boolean => {
      let descendantMatched = false;
      const children = childrenByParent.get(element);
      if (children) {
        for (const child of children) {
          if (results.length >= maxMatches) break;
          if (visit(child)) descendantMatched = true;
        }
      }
      if (descendantMatched) return true;
      if (results.length >= maxMatches) return false;
      if (!includesNeedle(element, needleLc)) return false;
      results.push(element);
      return true;
    };

    const topLevel = childrenByParent.get(root);
    if (!topLevel) return;
    for (const child of topLevel) {
      if (results.length >= maxMatches) return;
      visit(child);
    }
  };

  try {
    visitTree(document);
    for (let index = 0; index < shadowRoots.length && results.length < maxMatches; index += 1) {
      const shadow = shadowRoots[index];
      if (shadow) visitTree(shadow);
    }
  } catch {
    // Best-effort, matching the previous walker.
  }

  return results;
}
