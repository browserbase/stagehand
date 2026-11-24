import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

const excludedTags = new Set(["head", "script", "style", "template", "noscript"]);

export function normalizeQueryText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function createTextMatcher(text: string, exact = false): (candidate: string) => boolean {
  if (typeof text !== "string") throw new TypeError("Text queries require a string matcher");
  const needle = normalizeQueryText(text);
  const folded = needle.toLowerCase();
  return exact
    ? (candidate) => normalizeQueryText(candidate) === needle
    : (candidate) => normalizeQueryText(candidate).toLowerCase().includes(folded);
}

type QueryText = {
  full: string;
  normalized: string;
  children: Node[];
  eligible: boolean;
};

/** Keep this cache within one synchronous query so later queries see DOM changes. */
export function createTextQueryCache(): (node: Node) => QueryText {
  const cache = new WeakMap<Node, QueryText>();
  const read = (node: Node): QueryText => {
    const cached = cache.get(node);
    if (cached) return cached;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    const excluded =
      !!element &&
      (excludedTags.has(element.localName.toLowerCase()) ||
        !!element.ownerDocument.head?.contains(element));
    const children: Node[] = excluded ? [] : Array.from(node.childNodes);
    if (element && !excluded) {
      const shadow = getOpenOrClosedShadowRoot(element);
      if (shadow) children.push(shadow);
    }
    // Light DOM already contains assigned nodes; expanding slots would count them twice.
    let full = node.nodeType === Node.TEXT_NODE ? (node.nodeValue ?? "") : "";
    if (
      element?.localName === "input" &&
      /^(button|submit|reset)$/i.test((element as HTMLInputElement).type)
    ) {
      full = (element as HTMLInputElement).value;
    } else {
      for (const child of children) full += read(child).full;
    }
    const value = {
      full,
      normalized: normalizeQueryText(full),
      children,
      eligible: !!element && !excluded,
    };
    cache.set(node, value);
    return value;
  };
  return read;
}

export function collectNormalizedTextMatches(
  text: string,
  options: { exact?: boolean } = {},
  scope: Document | Element = document,
): Element[] {
  const matches = createTextMatcher(text, options.exact);
  const read = createTextQueryCache();
  const results: Element[] = [];
  const visit = (node: Node): boolean => {
    const content = read(node);
    let descendantMatches = false;
    for (const child of content.children) {
      if (visit(child)) descendantMatches = true;
    }
    const selfMatches = content.eligible && matches(content.normalized);
    if (node !== scope && selfMatches && !descendantMatches) results.push(node as Element);
    return selfMatches || descendantMatches;
  };
  visit(scope);
  return results;
}
