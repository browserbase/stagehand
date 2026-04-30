import {
  applyPredicates,
  parseXPathSteps,
  type XPathStep,
} from "../locatorScripts/xpathParser.js";

function buildClosedRootsMap(rootPairs: unknown[]): Map<Element, ShadowRoot> {
  const closedRoots = new Map<Element, ShadowRoot>();
  for (let i = 0; i < rootPairs.length; i += 2) {
    const host = rootPairs[i];
    const root = rootPairs[i + 1];
    if (host instanceof Element && root instanceof ShadowRoot) {
      closedRoots.set(host, root);
    }
  }
  return closedRoots;
}

function composedChildren(
  node: unknown,
  closedRoots: Map<Element, ShadowRoot>,
): Element[] {
  if (!node) return [];
  if (node instanceof Document) {
    return node.documentElement ? [node.documentElement] : [];
  }
  if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
    return Array.from(node.children || []);
  }
  if (!(node instanceof Element)) return [];

  const out = Array.from(node.children || []);
  if (node.shadowRoot) out.push(...Array.from(node.shadowRoot.children || []));
  const closed = closedRoots.get(node);
  if (closed) out.push(...Array.from(closed.children || []));
  return out;
}

function composedDescendants(
  node: unknown,
  closedRoots: Map<Element, ShadowRoot>,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(node, closedRoots)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);
    out.push(next);

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return out;
}

export function queryCssWithRoots(
  this: Document,
  selector: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
  const results: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(this, closedRoots)].reverse();

  while (stack.length && results.length < limit) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);

    try {
      if (next.matches(selector)) {
        results.push(next);
        if (results.length >= limit) break;
      }
    } catch {
      return [];
    }

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return results;
}

export function countCssWithRoots(
  this: Document,
  selector: string,
  ...rootPairs: unknown[]
): number {
  return queryCssWithRoots.call(
    this,
    selector,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

export function queryTextWithRoots(
  this: Document,
  needle: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
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
  const query = String(needle || "").toLowerCase();
  if (!query) return [];

  const extractText = (element: Element): string => {
    const tag = element.tagName ? element.tagName.toUpperCase() : "";
    if (skipTags.has(tag)) return "";
    try {
      const inner = (element as HTMLElement).innerText;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {
      // ignore
    }
    const text = element.textContent;
    return typeof text === "string" ? text.trim() : "";
  };

  const matches: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(this, closedRoots)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);

    const text = extractText(next);
    if (text && text.toLowerCase().includes(query)) {
      matches.push(next);
    }

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  const filtered: Element[] = [];
  for (const candidate of matches) {
    let covered = false;
    for (const other of matches) {
      if (candidate === other) continue;
      try {
        if (candidate.contains(other)) {
          covered = true;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!covered) {
      filtered.push(candidate);
      if (filtered.length >= limit) break;
    }
  }

  return filtered;
}

export function countTextWithRoots(
  this: Document,
  needle: string,
  ...rootPairs: unknown[]
): number {
  return queryTextWithRoots.call(
    this,
    needle,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

function normalizeXPath(selector: string): string {
  const raw = String(selector || "").trim();
  if (!raw) return "";
  return raw.replace(/^xpath=/i, "").trim();
}

function matchesTag(element: Element, step: XPathStep): boolean {
  if (step.tag === "*") return true;
  return element.localName === step.tag;
}

export function queryXPathWithRoots(
  this: Document,
  rawXPath: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
  const steps = parseXPathSteps(rawXPath);
  if (!steps.length) return [];

  let current: Array<Document | Element | ShadowRoot | DocumentFragment> = [
    this,
  ];

  for (const step of steps) {
    const next: Element[] = [];
    const seen = new Set<Element>();

    for (const root of current) {
      const pool =
        step.axis === "child"
          ? composedChildren(root, closedRoots)
          : composedDescendants(root, closedRoots);
      const tagMatches = pool.filter((candidate) =>
        matchesTag(candidate, step),
      );
      const matches = applyPredicates(tagMatches, step.predicates);

      for (const candidate of matches) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
          if (next.length >= limit && step === steps[steps.length - 1]) {
            break;
          }
        }
      }
    }

    if (!next.length) return [];
    current = next;
  }

  return current.slice(0, limit) as Element[];
}

export function countXPathWithRoots(
  this: Document,
  rawXPath: string,
  ...rootPairs: unknown[]
): number {
  return queryXPathWithRoots.call(
    this,
    rawXPath,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

export function queryXPathNative(
  this: Document,
  rawXPath: string,
  limit: number,
): Element[] {
  const xpath = normalizeXPath(rawXPath);
  if (!xpath || !Number.isFinite(limit) || limit <= 0) return [];
  try {
    const snapshot = this.evaluate(
      xpath,
      this,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const matches: Element[] = [];
    const max = Math.min(snapshot.snapshotLength, Math.floor(limit));
    for (let i = 0; i < max; i += 1) {
      const node = snapshot.snapshotItem(i);
      if (node instanceof Element) matches.push(node);
    }
    return matches;
  } catch {
    return [];
  }
}

export function countXPathNative(this: Document, rawXPath: string): number {
  const xpath = normalizeXPath(rawXPath);
  if (!xpath) return 0;
  try {
    const snapshot = this.evaluate(
      xpath,
      this,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    let count = 0;
    for (let i = 0; i < snapshot.snapshotLength; i += 1) {
      if (snapshot.snapshotItem(i) instanceof Element) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function hasOpenShadowRoots(this: Document): boolean {
  try {
    const walker = this.createTreeWalker(this, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node instanceof Element && node.shadowRoot) return true;
    }
  } catch {
    return false;
  }
  return false;
}
