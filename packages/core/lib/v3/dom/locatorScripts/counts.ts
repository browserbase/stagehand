export interface TextMatchSample {
  tag: string;
  id: string;
  class: string;
  text: string;
}

export interface TextMatchResult {
  count: number;
  sample: TextMatchSample[];
  error: null;
}

export function countCssMatchesPrimary(selectorRaw: string): number {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return 0;

  const seen = new WeakSet<Node>();

  const visit = (root: Node | null | undefined): number => {
    if (!root || seen.has(root)) return 0;
    seen.add(root);

    let total = 0;
    try {
      const queryable = root as unknown as ParentNode & {
        querySelectorAll?: Document["querySelectorAll"];
      };
      if (typeof queryable.querySelectorAll === "function") {
        total += queryable.querySelectorAll(selector).length;
      }
    } catch {
      // ignore query errors
    }

    try {
      const doc =
        root instanceof Document
          ? root
          : ((root as Element)?.ownerDocument ?? document);
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node instanceof Element && node.shadowRoot) {
          total += visit(node.shadowRoot);
        }
      }
    } catch {
      // ignore traversal errors
    }

    return total;
  };

  try {
    return visit(document);
  } catch {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }
}

export function countCssMatchesPierce(selectorRaw: string): number {
  const selector = String(selectorRaw ?? "").trim();
  if (!selector) return 0;

  const backdoor = window.__stagehandV3__;
  if (!backdoor || typeof backdoor.getClosedRoot !== "function") {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  const seen = new WeakSet<Node>();
  const queue: Node[] = [];

  const enqueue = (node: Node | null | undefined) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    queue.push(node);
  };

  enqueue(document);
  let total = 0;

  const visitElement = (element: Element) => {
    const open = element.shadowRoot;
    if (open) enqueue(open);
    try {
      const closed = backdoor.getClosedRoot(element);
      if (closed) enqueue(closed);
    } catch {
      // ignore
    }
  };

  while (queue.length) {
    const root = queue.shift();
    if (!root) continue;

    try {
      const queryable = root as unknown as ParentNode & {
        querySelectorAll?: Document["querySelectorAll"];
      };
      if (typeof queryable.querySelectorAll === "function") {
        total += queryable.querySelectorAll(selector).length;
      }
    } catch {
      // ignore query errors
    }

    try {
      const doc =
        root instanceof Document
          ? root
          : root instanceof ShadowRoot
            ? (root.host?.ownerDocument ?? document)
            : ((root as Element).ownerDocument ?? document);
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node instanceof Element) {
          visitElement(node);
        }
      }
    } catch {
      // ignore traversal errors
    }
  }

  return total;
}

export function countTextMatches(rawNeedle: string): TextMatchResult {
  const needle = String(rawNeedle ?? "");
  if (!needle) {
    return { count: 0, sample: [], error: null };
  }

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

  const extractText = (element: Element): string => {
    try {
      if (shouldSkip(element)) return "";
      const inner = (element as HTMLElement).innerText;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {
      // ignore
    }
    try {
      const text = element.textContent;
      if (typeof text === "string") return text.trim();
    } catch {
      // ignore
    }
    return "";
  };

  const matches = (element: Element): boolean => {
    const text = extractText(element);
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

  const matchesList: Array<{
    element: Element;
    tag: string;
    id: string;
    className: string;
    text: string;
  }> = [];

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
    if (!skip) innermost.push(item);
  }

  const count = innermost.length;
  const sample = innermost.slice(0, 5).map((item) => ({
    tag: item.tag,
    id: item.id,
    class: item.className,
    text: item.text,
  }));

  return { count, sample, error: null };
}

export function countXPathMatchesMainWorld(rawXp: string): number {
  const xp = String(rawXp ?? "").trim();
  if (!xp) return 0;

  const parseSteps = (input: string) => {
    const path = String(input || "")
      .trim()
      .replace(/^xpath=/i, "");
    if (!path)
      return [] as Array<{
        axis: "child" | "desc";
        tag: string;
        index: number | null;
      }>;

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
  if (!steps.length) return 0;

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

  let current: (Document | Element | ShadowRoot | DocumentFragment)[] = [
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

    if (!next.length) return 0;
    current = next;
  }

  return current.length;
}
