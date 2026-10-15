import { applyPredicates, parseXPathSteps, type XPathStep } from "./xpathParser.js";
import { documentHasShadowRoot, getOpenOrClosedShadowRoot } from "./shadowRoots.js";

type ShadowRootGetter = (host: Element) => ShadowRoot | null;
type TraversalRoot = Document | Element | ShadowRoot | DocumentFragment;

export type XPathResolveOptions = {
  pierceShadow?: boolean;
};

type ShadowContext = {
  getShadowRoot: ShadowRootGetter | null;
  hasShadow: boolean;
};

const normalizeXPath = (selector: string): string => {
  const raw = String(selector ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^xpath=/i, "").trim();
};

export function resolveXPathFirst(rawXp: string, options?: XPathResolveOptions): Element | null {
  return resolveXPathAtIndex(rawXp, 0, options);
}

export function resolveXPathAtIndex(
  rawXp: string,
  index: number,
  options?: XPathResolveOptions,
): Element | null {
  if (!Number.isFinite(index) || index < 0) return null;
  const matches = evaluateXPathMatches(rawXp, options);
  const targetIndex = Math.floor(index);
  if (Array.isArray(matches)) return matches[targetIndex] ?? null;
  return targetIndex < matches.snapshotLength
    ? (matches.snapshotItem(targetIndex) as Element | null)
    : null;
}

export function countXPathMatches(rawXp: string, options?: XPathResolveOptions): number {
  const matches = evaluateXPathMatches(rawXp, options);
  return Array.isArray(matches) ? matches.length : matches.snapshotLength;
}

export function queryXPathMatches(rawXp: string, options?: XPathResolveOptions): Element[] {
  const matches = evaluateXPathMatches(rawXp, options);
  return Array.isArray(matches)
    ? matches
    : Array.from(
        { length: matches.snapshotLength },
        (_, index) => matches.snapshotItem(index) as Element,
      );
}

/** Preserve the canonical match order without materializing native snapshots for index/count. */
function evaluateXPathMatches(
  rawXp: string,
  options?: XPathResolveOptions,
): XPathResult | Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext() : null;

  if (!shadowCtx?.hasShadow) {
    const native = evaluateNativeXPath(xp);
    if (!pierceShadow || native) return native ?? [];
    return resolveXPathComposedMatches(xp, shadowCtx?.getShadowRoot);
  }

  const shadowHopMatches = resolveStagehandShadowHopMatches(xp, shadowCtx.getShadowRoot);
  if (shadowHopMatches.length > 0) return shadowHopMatches;

  return resolveXPathComposedMatches(xp, shadowCtx.getShadowRoot);
}

export function resolveXPathComposedMatches(
  rawXp: string,
  getShadowRoot?: ShadowRootGetter | null,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const steps = parseXPathSteps(xp);
  if (!steps.length) return [];

  const shadowRootGetter = getShadowRoot ?? null;

  let current: TraversalRoot[] = [document];

  for (const step of steps) {
    const next: Element[] = [];
    const seen = new Set<Element>();

    for (const root of current) {
      const pool =
        step.axis === "child"
          ? composedChildren(root, shadowRootGetter)
          : composedDescendants(root, shadowRootGetter);
      if (!pool.length) continue;

      const tagMatches = pool.filter((candidate) => matchesTag(candidate, step));
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

function resolveStagehandShadowHopMatches(
  rawXp: string,
  getShadowRoot?: ShadowRootGetter | null,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const steps = parseXPathSteps(xp);
  if (!steps.some((step, index) => step.axis === "desc" && index > 0)) {
    return [];
  }

  const shadowRootGetter = getShadowRoot ?? null;
  let current: TraversalRoot[] = [document];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const next: Element[] = [];
    const seen = new Set<Element>();

    for (const root of current) {
      const pool =
        step.axis === "child"
          ? domChildren(root)
          : i === 0
            ? composedDescendants(root, shadowRootGetter)
            : shadowRootChildren(root, shadowRootGetter);
      if (!pool.length) continue;

      const tagMatches = pool.filter((candidate) => matchesTag(candidate, step));
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
  return { getShadowRoot: getOpenOrClosedShadowRoot, hasShadow: documentHasShadowRoot() };
}

function composedChildren(node: TraversalRoot, getShadowRoot: ShadowRootGetter | null): Element[] {
  const out: Element[] = [];

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
    const shadowRoot = getShadowRoot?.(node) ?? getOpenOrClosedShadowRoot(node);
    if (shadowRoot) out.push(...Array.from(shadowRoot.children ?? []));
    return out;
  }

  return out;
}

function domChildren(node: TraversalRoot): Element[] {
  const out: Element[] = [];

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
    return out;
  }

  return out;
}

function shadowRootChildren(
  node: TraversalRoot,
  getShadowRoot: ShadowRootGetter | null,
): Element[] {
  const out: Element[] = [];
  if (!(node instanceof Element)) return out;

  const shadowRoot = getShadowRoot?.(node) ?? getOpenOrClosedShadowRoot(node);
  if (shadowRoot) out.push(...Array.from(shadowRoot.children ?? []));

  return out;
}

function composedDescendants(
  node: TraversalRoot,
  getShadowRoot: ShadowRootGetter | null,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(node, getShadowRoot)].reverse();

  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);

    const children = composedChildren(next, getShadowRoot);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return out;
}

function evaluateNativeXPath(xp: string): XPathResult | null {
  try {
    return document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  } catch {
    return null;
  }
}
