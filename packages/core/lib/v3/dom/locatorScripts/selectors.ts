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
  const xp = String(rawXp ?? "").trim();
  if (!xp) return null;

  const targetIndex = parseTargetIndex(targetIndexRaw);
  const backdoor = window.__stagehandV3__;

  if (targetIndex === 0) {
    try {
      if (backdoor && typeof backdoor.resolveSimpleXPath === "function") {
        const fast = backdoor.resolveSimpleXPath(xp);
        if (fast) return fast;
      }
    } catch {
      // ignore backdoor errors and fall through
    }

    try {
      return document.evaluate(
        xp,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as Element | null;
    } catch {
      // ignore native XPath errors and fall through to composed traversal
    }
  }

  const parseSteps = (input: string) => {
    const s = String(input || "").trim();
    if (!s)
      return [] as Array<{
        axis: "child" | "desc";
        tag: string;
        index: number | null;
      }>;
    const path = s.replace(/^xpath=/i, "");
    const steps: Array<{
      axis: "child" | "desc";
      tag: string;
      index: number | null;
    }> = [];
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
      while (i < path.length && path[i] !== "/") i += 1;
      const rawStep = path.slice(start, i).trim();
      if (!rawStep) continue;
      const match = rawStep.match(/^(.*?)(\[(\d+)\])?$/u);
      const base = (match?.[1] ?? rawStep).trim();
      const index = match?.[3] ? Math.max(1, Number(match[3])) : null;
      const tag = base === "" ? "*" : base.toLowerCase();
      steps.push({ axis, tag, index });
    }
    return steps;
  };

  const steps = parseSteps(xp);
  if (!steps.length) return null;

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

      const matches = pool.filter((candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (step.tag === "*") return true;
        return candidate.localName === step.tag;
      });

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

  const target = current[targetIndex] as Element | undefined;
  return target ?? null;
}
