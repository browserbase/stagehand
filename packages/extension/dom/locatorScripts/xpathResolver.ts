import { applyPredicates, parseXPathSteps, type XPathStep } from "./xpathParser.js";
import { documentHasShadowRoot, getOpenOrClosedShadowRoot } from "./shadowRoots.js";

type ShadowRootGetter = (host: Element) => ShadowRoot | null;
type TraversalRoot = Document | Element | ShadowRoot | DocumentFragment;

export type XPathResolveOptions = {
  pierceShadow?: boolean;
  scope?: Document | Element;
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
  const targetIndex = Math.floor(index);
  return collectXPathMatches(rawXp, options, targetIndex + 1)[targetIndex] ?? null;
}

export function collectXPathMatches(
  rawXp: string,
  options?: XPathResolveOptions,
  limit = Infinity,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp || limit <= 0) return [];

  const scope = options?.scope ?? document;
  const pierceShadow = options?.pierceShadow !== false;
  const ownerDocument = scope instanceof Document ? scope : scope.ownerDocument;
  const shadowCtx = pierceShadow ? getShadowContext(ownerDocument) : null;

  // Element queries stay relative to their scope. Document queries retain the
  // generated-path shadow-hop route below, whose // semantics are different.
  if (scope instanceof Element) {
    const relative = xp.startsWith("/") ? `.${xp}` : xp;
    if (shadowCtx?.hasShadow) {
      return resolveXPathComposedMatches(
        relative.replace(/^\.\//, "/"),
        shadowCtx.getShadowRoot,
        scope,
      ).slice(0, limit);
    }
    return collectNativeMatchesWithError(relative, scope, limit).value;
  }

  if (!pierceShadow) {
    return collectNativeMatchesWithError(xp, scope, limit).value;
  }

  if (!shadowCtx?.hasShadow) {
    const native = collectNativeMatchesWithError(xp, scope, limit);
    if (!native.error) return native.value;
    const composed = resolveXPathComposedMatches(xp, shadowCtx?.getShadowRoot, scope);
    return composed.slice(0, limit);
  }

  const shadowHopMatches = resolveStagehandShadowHopMatches(xp, shadowCtx.getShadowRoot, scope);
  if (shadowHopMatches.length > 0) return shadowHopMatches.slice(0, limit);

  const composed = resolveXPathComposedMatches(xp, shadowCtx.getShadowRoot, scope);
  return composed.slice(0, limit);
}

export function countXPathMatches(rawXp: string, options?: XPathResolveOptions): number {
  if (options?.scope instanceof Element) return collectXPathMatches(rawXp, options).length;
  const scope = options?.scope ?? document;
  const xp = normalizeXPath(rawXp);
  if (!xp) return 0;

  const pierceShadow = options?.pierceShadow !== false;
  const shadowCtx = pierceShadow ? getShadowContext(scope) : null;

  if (!pierceShadow) {
    return resolveNativeCountWithError(xp, scope).count;
  }

  if (!shadowCtx?.hasShadow) {
    const count = resolveNativeCountWithError(xp, scope);
    if (!count.error) return count.count;
    return resolveXPathComposedMatches(xp, shadowCtx?.getShadowRoot, scope).length;
  }

  const shadowHopCount = resolveStagehandShadowHopMatches(
    xp,
    shadowCtx.getShadowRoot,
    scope,
  ).length;
  if (shadowHopCount > 0) return shadowHopCount;

  return resolveXPathComposedMatches(xp, shadowCtx.getShadowRoot, scope).length;
}

export function resolveXPathComposedMatches(
  rawXp: string,
  getShadowRoot?: ShadowRootGetter | null,
  scope: Document | Element = document,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const steps = parseXPathSteps(xp);
  if (!steps.length) return [];

  const shadowRootGetter = getShadowRoot ?? null;

  let current: TraversalRoot[] = [scope];

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
  scope: Document = document,
): Element[] {
  const xp = normalizeXPath(rawXp);
  if (!xp) return [];

  const steps = parseXPathSteps(xp);
  if (!steps.some((step, index) => step.axis === "desc" && index > 0)) {
    return [];
  }

  const shadowRootGetter = getShadowRoot ?? null;
  let current: TraversalRoot[] = [scope];

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

function getShadowContext(scope: Document): ShadowContext {
  return { getShadowRoot: getOpenOrClosedShadowRoot, hasShadow: documentHasShadowRoot(scope) };
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

function collectNativeMatchesWithError(
  xp: string,
  scope: Document | Element,
  limit: number,
): { value: Element[]; error: boolean } {
  try {
    const ownerDocument = scope instanceof Document ? scope : scope.ownerDocument;
    const snapshot = ownerDocument.evaluate(
      xp,
      scope,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const value: Element[] = [];
    for (let i = 0; i < snapshot.snapshotLength && value.length < limit; i += 1) {
      const node = snapshot.snapshotItem(i);
      // Preserve document XPath results, including its historical node casting.
      // Element-scoped queries must not return the scope itself or escape it.
      if (
        scope instanceof Element &&
        (!(node instanceof Element) || node === scope || !scope.contains(node))
      )
        continue;
      value.push(node as Element);
    }
    return { value, error: false };
  } catch {
    return { value: [], error: true };
  }
}

function resolveNativeCountWithError(
  xp: string,
  scope: Document,
): {
  count: number;
  error: boolean;
} {
  try {
    const snapshot = scope.evaluate(xp, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return { count: snapshot.snapshotLength, error: false };
  } catch {
    return { count: 0, error: true };
  }
}
