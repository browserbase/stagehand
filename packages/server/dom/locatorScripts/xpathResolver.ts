import { applyPredicates, parseXPathSteps, type XPathStep } from "./xpathParser.js";
import { isAgentIndicatorHost, isAgentIndicatorInstalled } from "../agentIndicator.js";
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
    const composed = resolveXPathComposedMatches(xp, shadowCtx?.getShadowRoot);
    return composed[targetIndex] ?? null;
  }

  const shadowHopMatches = resolveStagehandShadowHopMatches(xp, shadowCtx.getShadowRoot);
  if (shadowHopMatches.length > 0) return shadowHopMatches[targetIndex] ?? null;

  const composed = resolveXPathComposedMatches(xp, shadowCtx.getShadowRoot);
  return composed[targetIndex] ?? null;
}

export function countXPathMatches(rawXp: string, options?: XPathResolveOptions): number {
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
    return resolveXPathComposedMatches(xp, shadowCtx?.getShadowRoot).length;
  }

  const shadowHopCount = resolveStagehandShadowHopMatches(xp, shadowCtx.getShadowRoot).length;
  if (shadowHopCount > 0) return shadowHopCount;

  return resolveXPathComposedMatches(xp, shadowCtx.getShadowRoot).length;
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
    out.push(...Array.from(node.children ?? []).filter((child) => !isAgentIndicatorHost(child)));
    return out;
  }

  if (node instanceof Element) {
    if (isAgentIndicatorHost(node)) return out;
    out.push(...Array.from(node.children ?? []).filter((child) => !isAgentIndicatorHost(child)));
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
    out.push(...Array.from(node.children ?? []).filter((child) => !isAgentIndicatorHost(child)));
    return out;
  }

  if (node instanceof Element) {
    if (isAgentIndicatorHost(node)) return out;
    out.push(...Array.from(node.children ?? []).filter((child) => !isAgentIndicatorHost(child)));
    return out;
  }

  return out;
}

function shadowRootChildren(
  node: TraversalRoot,
  getShadowRoot: ShadowRootGetter | null,
): Element[] {
  const out: Element[] = [];
  if (!(node instanceof Element) || isAgentIndicatorHost(node)) return out;

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

function resolveNativeAtIndexWithError(
  xp: string,
  index: number,
): { value: Element | null; error: boolean } {
  try {
    const evaluation = createNativeXPathEvaluationContext();
    const snapshot = evaluation.document.evaluate(
      xp,
      evaluation.document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const result = snapshot.snapshotItem(index);
    return {
      value: evaluation.toOriginal(result) as Element | null,
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
    const evaluation = createNativeXPathEvaluationContext();
    const snapshot = evaluation.document.evaluate(
      xp,
      evaluation.document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return { count: snapshot.snapshotLength, error: false };
  } catch {
    return { count: 0, error: true };
  }
}

type NativeXPathEvaluationContext = {
  document: Document;
  toOriginal: (node: Node | null) => Node | null;
};

type NativeXPathMirrorCache = {
  source: Document;
  context: NativeXPathEvaluationContext;
  observer: MutationObserver;
  synchronize: (records: MutationRecord[]) => boolean;
  pendingRecords: MutationRecord[];
  pendingMutationCost: number;
};

let nativeXPathMirrorCache: NativeXPathMirrorCache | null = null;
const MAX_INCREMENTAL_MIRROR_MUTATION_COST = 256;

function disposeNativeXPathMirror(cache: NativeXPathMirrorCache | null): void {
  if (!cache) return;
  // Drain pending records before disconnecting so they cannot retain removed
  // subtrees through the observer's delivery queue.
  cache.observer.takeRecords();
  cache.observer.disconnect();
  cache.pendingRecords.length = 0;
  if (nativeXPathMirrorCache === cache) nativeXPathMirrorCache = null;
}

/**
 * Native XPath applies positional predicates before callers can filter the
 * result. When the indicator is present, evaluate against a detached mirror
 * that omits its host so the page never observes locator-time DOM mutations.
 */
function createNativeXPathEvaluationContext(): NativeXPathEvaluationContext {
  if (!isAgentIndicatorInstalled()) {
    disposeNativeXPathMirror(nativeXPathMirrorCache);
    return { document, toOriginal: (node) => node };
  }

  const cached = nativeXPathMirrorCache;
  if (cached?.source === document) {
    const records = cached.pendingRecords.splice(0).concat(cached.observer.takeRecords());
    cached.pendingMutationCost = 0;
    if (records.length === 0 || cached.synchronize(records)) return cached.context;
    disposeNativeXPathMirror(cached);
  } else if (cached) {
    disposeNativeXPathMirror(cached);
  }

  // createHTMLDocument preserves Chromium's HTML XPath rules, including
  // ASCII-case-insensitive HTML element name tests. It has no browsing
  // context, so cloning custom elements cannot run page constructors.
  const mirror = document.implementation.createHTMLDocument("");
  while (mirror.firstChild) mirror.removeChild(mirror.firstChild);
  const originals = new WeakMap<Node, Node>();
  const mirrors = new WeakMap<Node, Node>();
  originals.set(mirror, document);
  mirrors.set(document, mirror);

  const cloneIntoMirror = (source: Node): Node | null => {
    if (source instanceof Element) {
      if (isAgentIndicatorHost(source)) return null;
      const qualifiedName = source.prefix
        ? `${source.prefix}:${source.localName}`
        : source.localName;
      const clone = mirror.createElementNS(source.namespaceURI, qualifiedName);
      originals.set(clone, source);
      mirrors.set(source, clone);
      for (const attribute of source.attributes) {
        try {
          clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
          const clonedAttribute = clone.getAttributeNodeNS(
            attribute.namespaceURI,
            attribute.localName,
          );
          if (clonedAttribute) originals.set(clonedAttribute, attribute);
        } catch {
          // A malformed namespaced attribute cannot affect supported element locators.
        }
      }
      for (const child of source.childNodes) {
        const childClone = cloneIntoMirror(child);
        if (childClone) clone.appendChild(childClone);
      }
      return clone;
    }

    let clone: Node | null = null;
    if (source.nodeType === Node.TEXT_NODE) clone = mirror.createTextNode(source.nodeValue ?? "");
    else if (source.nodeType === Node.CDATA_SECTION_NODE)
      clone = mirror.createCDATASection(source.nodeValue ?? "");
    else if (source.nodeType === Node.COMMENT_NODE)
      clone = mirror.createComment(source.nodeValue ?? "");
    else if (source.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const doctype = source as DocumentType;
      clone = mirror.implementation.createDocumentType(
        doctype.name,
        doctype.publicId,
        doctype.systemId,
      );
    }

    if (clone) originals.set(clone, source);
    if (clone) mirrors.set(source, clone);
    return clone;
  };

  for (const child of document.childNodes) {
    const clone = cloneIntoMirror(child);
    if (clone) mirror.appendChild(clone);
  }

  const context: NativeXPathEvaluationContext = {
    document: mirror,
    toOriginal: (node) => (node ? (originals.get(node) ?? null) : null),
  };

  // Bring the detached tree current in proportion to the mutations made by
  // the page. Synchronization is deferred until the next XPath lookup so pages
  // that stop using XPath do not pay a permanent mutation-time cost.
  const synchronize = (records: MutationRecord[]): boolean => {
    try {
      const clonedSourceRoots: Node[] = [];
      const detachPreviouslyMirroredSubtree = (source: Node): void => {
        const previousMirror = mirrors.get(source);
        if (previousMirror?.parentNode) previousMirror.parentNode.removeChild(previousMirror);
        for (const child of source.childNodes) detachPreviouslyMirroredSubtree(child);
      };

      for (const record of records) {
        // Added subtrees are cloned from their final live state. Later records
        // inside one would replay changes already captured by that clone (and
        // can otherwise duplicate children).
        if (clonedSourceRoots.some((root) => root.contains(record.target))) continue;

        const mirroredTarget = mirrors.get(record.target);
        // The indicator host and everything below it is deliberately absent.
        if (!mirroredTarget) continue;

        if (record.type === "attributes") {
          const source = record.target as Element;
          const target = mirroredTarget as Element;
          const namespace = record.attributeNamespace;
          const localName = record.attributeName!;
          const sourceAttribute = source.getAttributeNodeNS(namespace, localName);
          if (!sourceAttribute) {
            target.removeAttributeNS(namespace, localName);
            continue;
          }
          target.setAttributeNS(namespace, sourceAttribute.name, sourceAttribute.value);
          const targetAttribute = target.getAttributeNodeNS(namespace, sourceAttribute.localName);
          if (targetAttribute) {
            originals.set(targetAttribute, sourceAttribute);
            mirrors.set(sourceAttribute, targetAttribute);
          }
          continue;
        }

        if (record.type === "characterData") {
          mirroredTarget.nodeValue = record.target.nodeValue;
          continue;
        }

        for (const removed of record.removedNodes) {
          const mirroredRemoved = mirrors.get(removed);
          if (mirroredRemoved?.parentNode === mirroredTarget) {
            mirroredTarget.removeChild(mirroredRemoved);
          }
        }

        for (const added of record.addedNodes) {
          // Descendants may have moved here from elsewhere in the document.
          // Detach their old mirror nodes before cloneIntoMirror remaps them.
          detachPreviouslyMirroredSubtree(added);

          const mirroredAdded = cloneIntoMirror(added);
          if (!mirroredAdded) continue;
          clonedSourceRoots.push(added);
          let sourceNext = record.nextSibling;
          let mirroredNext: Node | null = null;
          while (sourceNext) {
            const candidate = mirrors.get(sourceNext);
            if (candidate?.parentNode === mirroredTarget) {
              mirroredNext = candidate;
              break;
            }
            sourceNext = sourceNext.nextSibling;
          }
          mirroredTarget.insertBefore(mirroredAdded, mirroredNext);
        }
      }
      return true;
    } catch {
      // A rare DOM shape that cannot be mirrored safely falls back to a fresh
      // snapshot on this lookup rather than returning stale XPath results.
      return false;
    }
  };

  const mutationCostWithinLimit = (records: MutationRecord[], limit: number): number | null => {
    let cost = 0;
    const visitAddedNode = (node: Node): boolean => {
      cost += 1;
      if (node instanceof Element) cost += node.attributes.length;
      if (cost > limit) return false;
      for (const child of node.childNodes) {
        if (!visitAddedNode(child)) return false;
      }
      return true;
    };

    for (const record of records) {
      cost += 1 + record.removedNodes.length;
      if (cost > limit) return null;
      for (const added of record.addedNodes) {
        if (!visitAddedNode(added)) return null;
      }
    }
    return cost;
  };

  let cache: NativeXPathMirrorCache;
  const observer = new MutationObserver((records) => {
    // Mutations inside a newly added subtree are already represented by the
    // eventual clone of its queued ancestor. The indicator is absent too.
    const relevantRecords = records.filter((record) => mirrors.has(record.target));
    if (relevantRecords.length === 0) return;

    const remainingBudget = MAX_INCREMENTAL_MIRROR_MUTATION_COST - cache.pendingMutationCost;
    const cost = mutationCostWithinLimit(relevantRecords, remainingBudget);
    if (cost === null) {
      disposeNativeXPathMirror(cache);
      return;
    }

    const containsRemovedNodes = relevantRecords.some(
      (record) => record.type === "childList" && record.removedNodes.length > 0,
    );
    if (containsRemovedNodes) {
      // Apply removal batches immediately so records cannot retain detached
      // subtrees. This is still proportional to the changed subtree, and also
      // covers common SPA list reconciliation without rebuilding the document.
      const pending = cache.pendingRecords.splice(0);
      cache.pendingMutationCost = 0;
      if (!synchronize(pending.concat(relevantRecords))) disposeNativeXPathMirror(cache);
      return;
    }

    cache.pendingRecords.push(...relevantRecords);
    cache.pendingMutationCost += cost;
  });
  cache = {
    source: document,
    context,
    observer,
    synchronize,
    pendingRecords: [],
    pendingMutationCost: 0,
  };
  observer.observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  nativeXPathMirrorCache = cache;
  return context;
}
