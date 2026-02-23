import { resolveXPathAtIndex } from "./xpathResolver.js";

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
        root instanceof Document
          ? root
          : (root.host?.ownerDocument ?? document);
      const walker = ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        const open = node.shadowRoot;
        if (open) queue.push(open);
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

export function resolveCssSelector(
  selectorRaw: string,
  targetIndexRaw?: number,
): Element | null {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return null;

  const targetIndex = parseTargetIndex(targetIndexRaw);
  const matches = collectCssMatches(selector, targetIndex + 1);
  return matches[targetIndex] ?? null;
}

export function resolveCssSelectorPierce(
  selectorRaw: string,
  targetIndexRaw?: number,
): Element | null {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return null;

  const targetIndex = parseTargetIndex(targetIndexRaw);
  const backdoor = window.__stagehandV3__;
  if (!backdoor || typeof backdoor.getClosedRoot !== "function") {
    const matches = collectCssMatches(selector, targetIndex + 1);
    return matches[targetIndex] ?? null;
  }

  const getClosedRoot: (host: Element) => ShadowRoot | null = (
    host: Element,
  ) => {
    try {
      return backdoor.getClosedRoot(host) ?? null;
    } catch {
      return null;
    }
  };

  const seenRoots = new WeakSet<Node>();
  const seenElements = new Set<Element>();
  const results: Element[] = [];
  const queue: Array<Document | ShadowRoot> = [document];

  const visit = (root: Document | ShadowRoot): void => {
    if (!root || seenRoots.has(root) || results.length >= targetIndex + 1)
      return;
    seenRoots.add(root);

    try {
      const matches = root.querySelectorAll(selector);
      for (const element of matches) {
        if (seenElements.has(element)) continue;
        seenElements.add(element);
        results.push(element);
        if (results.length >= targetIndex + 1) return;
      }
    } catch {
      // ignore query errors
    }

    try {
      const ownerDocument =
        root instanceof Document
          ? root
          : (root.host?.ownerDocument ?? document);
      const walker = ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node instanceof Element)) continue;
        const open = node.shadowRoot;
        if (open) queue.push(open);
        const closed = getClosedRoot(node);
        if (closed) queue.push(closed);
      }
    } catch {
      // ignore traversal issues
    }
  };

  while (queue.length && results.length < targetIndex + 1) {
    const next = queue.shift();
    if (next) visit(next);
  }

  return results[targetIndex] ?? null;
}

export function resolveTextSelector(
  rawNeedle: string,
  targetIndexRaw?: number,
): Element | null {
  const needle = String(rawNeedle ?? "");
  if (!needle) return null;
  const needleLc = needle.toLowerCase();
  const targetIndex = parseTargetIndex(targetIndexRaw);

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

  const backdoor = window.__stagehandV3__;
  const getClosedRoot: (host: Element) => ShadowRoot | null =
    backdoor && typeof backdoor.getClosedRoot === "function"
      ? (host: Element): ShadowRoot | null => {
          try {
            return backdoor.getClosedRoot(host) ?? null;
          } catch {
            return null;
          }
        }
      : (host: Element): ShadowRoot | null => {
          void host;
          return null;
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
      const doc =
        root instanceof Document
          ? root
          : ((root as Element)?.ownerDocument ?? document);
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

      const open = node.shadowRoot;
      if (open) enqueue(open);

      const closed = getClosedRoot(node);
      if (closed) enqueue(closed);
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

  const target = innermost[targetIndex];
  return target?.element ?? null;
}

export function resolveXPathMainWorld(
  rawXp: string,
  targetIndexRaw?: number,
): Element | null {
  const targetIndex = parseTargetIndex(targetIndexRaw);
  return resolveXPathAtIndex(rawXp, targetIndex, { pierceShadow: true });
}
