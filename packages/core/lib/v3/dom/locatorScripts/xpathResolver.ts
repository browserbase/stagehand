import {
  applyPredicates,
  parseXPathSteps,
  type XPathStep,
} from "./xpathParser.js";

type ClosedRootGetter = (host: Element) => ShadowRoot | null;

export type XPathResolveOptions = {
  pierceShadow?: boolean;
};

type ShadowContext = {
  getClosedRoot: ClosedRootGetter | null;
  hasShadow: boolean;
};

const normalizeXPath = (selector: string): string => {
  const raw = String(selector ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^xpath=/i, "").trim();
};

export function resolveXPathFirst(
  rawXp: string,
  options?: XPathResolveOptions,
): Element | null {
  return resolveXPathAtIndex(rawXp, 0, options);
}

export function resolveXPathAtIndex(
  rawXp: string,
  index: number,
  options?: XPathResolveOptions,
): Element | null {
  if (!Number.isFinite(index) || index < 0) return null;
  const xp = normalizeXPath(rawXp);
  if (!xp) return null;

  const targetIndex = Math.floor(index);
  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext() : null;

  if (!pierceShadow) {
    return resolveNativeAtIndexWithError(xp, targetIndex).value;
  }

  if (!shadowCtx?.hasShadow) {
    const native = resolveNativeAtIndexWithError(xp, targetIndex);
    if (!native.error) return native.value;
    const composed = resolveXPathComposedMatches(xp, shadowCtx?.getClosedRoot);
    return composed[targetIndex] ?? null;
  }

  const composed = resolveXPathComposedMatches(xp, shadowCtx.getClosedRoot);
  return composed[targetIndex] ?? null;
}

export function countXPathMatches(
  rawXp: string,
  options?: XPathResolveOptions,
): number {
  const xp = normalizeXPath(rawXp);
  if (!xp) return 0;

  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext() : null;

  if (!pierceShadow) {
    return resolveNativeCountWithError(xp).count;
  }

  if (!shadowCtx?.hasShadow) {
    const count = resolveNativeCountWithError(xp);
    if (!count.error) return count.count;
    return resolveXPathComposedMatches(xp, shadowCtx?.getClosedRoot).length;
  }

  return resolveXPathComposedMatches(xp, shadowCtx.getClosedRoot).length;
}

export function resolveXPathComposedMatches(
  rawXp: string,
  getClosedRoot?: ClosedRootGetter | null,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const steps = parseXPathSteps(xp);
  if (!steps.length) return [];

  const closedRoot = getClosedRoot ?? null;

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
          ? composedChildren(root, closedRoot)
          : composedDescendants(root, closedRoot);
      if (!pool.length) continue;

      const tagMatches = pool.filter((candidate) =>
        matchesTag(candidate, step),
      );
      const matches = applyPredicates(tagMatches, step.predicates);

      for (const candidate of matches) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }

    if (!next.length) return [];
    current = next;
  }

  return current as Element[];
}

function matchesTag(element: Element, step: XPathStep): boolean {
  if (step.tag === "*") return true;
  return element.localName === step.tag;
}

function getShadowContext(): ShadowContext {
  const backdoor = window.__stagehandV3__;
  const getClosedRoot: ClosedRootGetter | null =
    backdoor && typeof backdoor.getClosedRoot === "function"
      ? (host: Element): ShadowRoot | null => {
          try {
            return backdoor.getClosedRoot(host) ?? null;
          } catch {
            return null;
          }
        }
      : null;

  let hasShadow = false;
  try {
    if (backdoor && typeof backdoor.stats === "function") {
      const stats = backdoor.stats();
      hasShadow = (stats?.open ?? 0) > 0 || (stats?.closed ?? 0) > 0;
    }
  } catch {
    // ignore stats errors
  }

  if (!hasShadow) {
    try {
      const walker = document.createTreeWalker(
        document,
        NodeFilter.SHOW_ELEMENT,
      );
      while (walker.nextNode()) {
        const el = walker.currentNode as Element;
        if (el.shadowRoot) {
          hasShadow = true;
          break;
        }
      }
    } catch {
      // ignore scan errors
    }
  }

  return { getClosedRoot, hasShadow };
}

function composedChildren(
  node: Node | null | undefined,
  getClosedRoot: ClosedRootGetter | null,
): Element[] {
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
    if (getClosedRoot) {
      const closed = getClosedRoot(node);
      if (closed) out.push(...Array.from(closed.children ?? []));
    }
    return out;
  }

  return out;
}

function composedDescendants(
  node: Node | null | undefined,
  getClosedRoot: ClosedRootGetter | null,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(node, getClosedRoot)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);

    const children = composedChildren(next, getClosedRoot);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return out;
}

function resolveNativeAtIndexWithError(
  xp: string,
  index: number,
): { value: Element | null; error: boolean } {
  try {
    const snapshot = document.evaluate(
      xp,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return {
      value: snapshot.snapshotItem(index) as Element | null,
      error: false,
    };
  } catch {
    return { value: null, error: true };
  }
}

function resolveNativeCountWithError(xp: string): {
  count: number;
  error: boolean;
} {
  try {
    const snapshot = document.evaluate(
      xp,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return { count: snapshot.snapshotLength, error: false };
  } catch {
    return { count: 0, error: true };
  }
}
