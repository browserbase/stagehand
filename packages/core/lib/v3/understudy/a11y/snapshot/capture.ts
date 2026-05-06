import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { Page } from "../../page.js";
import { Frame } from "../../frame.js";
import {
  FrameSelectorResolver,
  type ResolvedNode,
  type SelectorQuery,
} from "../../selectorResolver.js";
import { v3Logger } from "../../../logger.js";
import type {
  FrameContext,
  FrameDomMaps,
  FrameParentIndex,
  HybridSnapshot,
  SnapshotOptions,
  SessionDomIndex,
} from "../../../types/private/index.js";
import { a11yForFrame } from "./a11yTree.js";
import {
  resolveCssFocusFrameAndTail,
  resolveFocusFrameAndTail,
  listChildrenOf,
} from "./focusSelectors.js";
import {
  buildSessionDomIndex,
  domMapsForSession,
  relativizeXPath,
} from "./domTree.js";
import { injectSubtrees } from "./treeFormatUtils.js";
import { ownerSession, parentSession } from "./sessions.js";
import { normalizeXPath, prefixXPath } from "./xpathUtils.js";

type IgnoredNodeMap = Map<string, Set<number>>;
type Interval = { start: number; end: number };
type ExclusionIntervalsByFrame = Map<string, Interval[]>;
type ChildFrameHost = { childFrameId: string; hostBackendNodeId: number };
type ChildFramesByParent = Map<string, ChildFrameHost[]>;

/**
 * Capture a hybrid DOM + Accessibility snapshot for the provided page.
 *
 * Flow overview:
 * 1. (Optional) Scope directly to a requested selector. We walk iframe hops to
 *    find the owning frame, build just that frame’s DOM + AX tree, and bail out
 *    early when the subtree satisfies the caller.
 * 2. Build DOM indexes for every unique CDP session. DOM.getDocument is called
 *    once per session and hydrated so per-frame slices can share the result.
 * 3. Slice each frame’s DOM data from its session index and fetch its AX tree.
 *    This yields relative XPath/tag/url maps for the document rooted at that frame.
 * 4. Walk the frame tree to compute absolute iframe prefixes. Every child frame
 *    needs the XPath of the iframe element that hosts it so we can prefix maps.
 * 5. Merge all per-frame results into global combined maps and stitch the text
 *    outline. The final payload mirrors the legacy shape but is built in layers.
 *
 * Each numbered block below references the step above for easier debugging.
 */
export async function captureHybridSnapshot(
  page: Page,
  options?: SnapshotOptions,
): Promise<HybridSnapshot> {
  const pierce = options?.pierceShadow ?? true;
  const includeIframes = options?.includeIframes !== false;
  const hasIgnoreSelectors = (options?.ignoreSelectors?.length ?? 0) > 0;

  const context = buildFrameContext(page);
  const framesInScope = includeIframes ? [...context.frames] : [context.rootId];
  if (!framesInScope.includes(context.rootId)) {
    framesInScope.unshift(context.rootId);
  }

  if (!hasIgnoreSelectors) {
    const scopedSnapshot = await tryScopedSnapshot(
      page,
      options,
      context,
      pierce,
      new Map<string, SessionDomIndex>(),
      new Map(),
    );
    if (scopedSnapshot) return scopedSnapshot;
  }

  const sessionToIndex = await buildSessionIndexes(page, framesInScope, pierce);
  const ignoredNodesByFrame = await resolveIgnoredNodes(
    page,
    options?.ignoreSelectors,
    context,
    sessionToIndex,
  );
  const exclusionIntervalsByFrame = await buildFrameExclusionIntervals(
    page,
    context,
    sessionToIndex,
    ignoredNodesByFrame,
  );
  if (hasIgnoreSelectors) {
    const scopedSnapshot = await tryScopedSnapshot(
      page,
      options,
      context,
      pierce,
      sessionToIndex,
      exclusionIntervalsByFrame,
    );
    if (scopedSnapshot) return scopedSnapshot;
  }

  const { perFrameMaps, perFrameOutlines } = await collectPerFrameMaps(
    page,
    context,
    sessionToIndex,
    options,
    pierce,
    framesInScope,
    exclusionIntervalsByFrame,
  );
  const { absPrefix, iframeHostEncByChild } = await computeFramePrefixes(
    page,
    context,
    perFrameMaps,
    framesInScope,
  );

  return mergeFramesIntoSnapshot(
    context,
    perFrameMaps,
    perFrameOutlines,
    absPrefix,
    iframeHostEncByChild,
    framesInScope,
  );
}

/**
 * Snapshot the current frame tree so downstream helpers have consistent topology
 * without re-querying CDP. The map is intentionally shallow (frameId → parentId)
 * so it is serializable/testable without holding on to CDP handles.
 */
export function buildFrameContext(page: Page): FrameContext {
  const rootId = page.mainFrameId();
  const frameTree = page.asProtocolFrameTree(rootId);
  const parentByFrame: FrameParentIndex = new Map();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(frameTree, null);
  const frames = page.listAllFrameIds();
  return { rootId, parentByFrame, frames };
}

/**
 * Step 1 – scoped snapshot fast-path. If a selector is provided we try to:
 *  1) Resolve the selector (XPath or CSS) across iframes.
 *  2) Build DOM + AX data only for the owning frame.
 *  3) Bail out early when the selector's subtree satisfies the request.
 *
 * Returns `null` when scoping fails (e.g., selector miss) so the caller can
 * fall back to the full multi-frame snapshot.
 */
export async function tryScopedSnapshot(
  page: Page,
  options: SnapshotOptions | undefined,
  context: FrameContext,
  pierce: boolean,
  sessionToIndex: Map<string, SessionDomIndex>,
  exclusionIntervalsByFrame: ExclusionIntervalsByFrame,
): Promise<HybridSnapshot | null> {
  const requestedFocus = options?.focusSelector?.trim();
  if (!requestedFocus) return null;

  const logScopeFallback = () => {
    v3Logger({
      message: `Unable to narrow scope with selector. Falling back to using full DOM`,
      level: 1,
      auxiliary: {
        arguments: {
          value: `selector: ${options?.focusSelector?.trim()}`,
          type: "string",
        },
      },
    });
  };

  try {
    let targetFrameId: string;
    let tailSelector: string | undefined;
    let absPrefix: string | undefined;

    const looksLikeXPath =
      /^xpath=/i.test(requestedFocus) || requestedFocus.startsWith("/");
    if (looksLikeXPath) {
      const focus = normalizeXPath(requestedFocus);
      const hit = await resolveFocusFrameAndTail(
        page,
        focus,
        context.parentByFrame,
        context.rootId,
      );
      targetFrameId = hit.targetFrameId;
      tailSelector = hit.tailXPath || undefined;
      absPrefix = hit.absPrefix;
    } else {
      const cssHit = await resolveCssFocusFrameAndTail(
        page,
        requestedFocus,
        context.parentByFrame,
        context.rootId,
      );
      targetFrameId = cssHit.targetFrameId;
      tailSelector = cssHit.tailSelector || undefined;
      absPrefix = cssHit.absPrefix;
    }

    const owningSess = ownerSession(page, targetFrameId);
    const parentId = context.parentByFrame.get(targetFrameId);
    const sameSessionAsParent =
      !!parentId &&
      ownerSession(page, parentId) === ownerSession(page, targetFrameId);
    const { tagNameMap, xpathMap, scrollableMap } = await domMapsForSession(
      owningSess,
      targetFrameId,
      pierce,
      (fid, be) => `${page.getOrdinal(fid)}-${be}`,
      sameSessionAsParent,
    );

    const { outline, urlMap, scopeApplied } = await a11yForFrame(
      owningSess,
      targetFrameId,
      {
        focusSelector: tailSelector || undefined,
        isIgnoredBackendNode: makeIsIgnoredBackendNode(
          targetFrameId,
          ownerSessionIndexForFrame(page, targetFrameId, sessionToIndex),
          exclusionIntervalsByFrame,
        ),
        tagNameMap,
        experimental: options?.experimental ?? false,
        scrollableMap,
        encode: (backendNodeId) =>
          `${page.getOrdinal(targetFrameId)}-${backendNodeId}`,
      },
    );

    const scopedXpathMap: Record<string, string> = {};
    const isIgnoredBackendNode = makeIsIgnoredBackendNode(
      targetFrameId,
      ownerSessionIndexForFrame(page, targetFrameId, sessionToIndex),
      exclusionIntervalsByFrame,
    );
    const abs = absPrefix ?? "";
    const isRoot = !abs || abs === "/";
    if (isRoot) {
      for (const [encId, xp] of Object.entries(xpathMap)) {
        const backendNodeId = parseEncodedBackendNodeId(encId);
        if (
          typeof backendNodeId === "number" &&
          isIgnoredBackendNode?.(backendNodeId)
        ) {
          continue;
        }
        scopedXpathMap[encId] = xp;
      }
    } else {
      // Prefix relative XPaths so the scoped result matches the global encoding.
      for (const [encId, xp] of Object.entries(xpathMap)) {
        const backendNodeId = parseEncodedBackendNodeId(encId);
        if (
          typeof backendNodeId === "number" &&
          isIgnoredBackendNode?.(backendNodeId)
        ) {
          continue;
        }
        scopedXpathMap[encId] = prefixXPath(abs, xp);
      }
    }

    const scopedUrlMap: Record<string, string> = { ...urlMap };

    const snapshot: HybridSnapshot = {
      combinedTree: outline,
      combinedXpathMap: scopedXpathMap,
      combinedUrlMap: scopedUrlMap,
      perFrame: [
        {
          frameId: targetFrameId,
          outline,
          xpathMap,
          urlMap,
        },
      ],
    };

    if (scopeApplied) {
      return snapshot;
    }

    logScopeFallback();
  } catch {
    logScopeFallback();
  }
  return null;
}

/**
 * Step 2 – call DOM.getDocument once per unique CDP session and hydrate the
 * result so per-frame slices can share the structure. We key by session id
 * because same process iframes live inside the same session.
 */
export async function buildSessionIndexes(
  page: Page,
  frames: string[],
  pierce: boolean,
): Promise<Map<string, SessionDomIndex>> {
  const sessionToIndex = new Map<string, SessionDomIndex>();
  const sessionById = new Map<string, CDPSessionLike>();
  for (const frameId of frames) {
    const sess = ownerSession(page, frameId);
    const sid = sess.id ?? "root";
    if (!sessionById.has(sid)) sessionById.set(sid, sess);
  }
  for (const [sid, sess] of sessionById.entries()) {
    const idx = await buildSessionDomIndex(sess, pierce);
    sessionToIndex.set(sid, idx);
  }
  return sessionToIndex;
}

/**
 * Step 3 – derive per-frame DOM maps and accessibility outlines.
 * Each frame:
 *  - slices the shared session index down to its document root
 *  - builds frame-aware encoded ids (ordinal-backendNodeId)
 *  - collects tag/xpath/scrollability maps for DOM-based lookups
 *  - fetches its AX tree to produce outlines and URL maps
 */
export async function collectPerFrameMaps(
  page: Page,
  context: FrameContext,
  sessionToIndex: Map<string, SessionDomIndex>,
  options: SnapshotOptions | undefined,
  pierce: boolean,
  frameIds: string[],
  exclusionIntervalsByFrame: ExclusionIntervalsByFrame,
): Promise<{
  perFrameMaps: Map<string, FrameDomMaps>;
  perFrameOutlines: Array<{ frameId: string; outline: string }>;
}> {
  const perFrameMaps = new Map<string, FrameDomMaps>();
  const perFrameOutlines: Array<{ frameId: string; outline: string }> = [];

  for (const frameId of frameIds) {
    const sess = ownerSession(page, frameId);
    const sid = sess.id ?? "root";
    let idx = sessionToIndex.get(sid);
    if (!idx) {
      idx = await buildSessionDomIndex(sess, pierce);
      sessionToIndex.set(sid, idx);
    }

    const parentId = context.parentByFrame.get(frameId);
    const sameSessionAsParent =
      !!parentId && ownerSession(page, parentId) === sess;

    const docRootBe = await resolveFrameDocRootBackendId(
      page,
      frameId,
      idx,
      sameSessionAsParent,
    );

    const tagNameMap: Record<string, string> = {};
    const xpathMap: Record<string, string> = {};
    const scrollableMap: Record<string, boolean> = {};
    const isIgnoredBackendNode = makeIsIgnoredBackendNode(
      frameId,
      idx,
      exclusionIntervalsByFrame,
    );
    const enc = (be: number) => `${page.getOrdinal(frameId)}-${be}`;
    const baseAbs = idx.absByBe.get(docRootBe) ?? "/";

    for (const [be, nodeAbs] of idx.absByBe.entries()) {
      const nodeDocRoot = idx.docRootOf.get(be);
      if (nodeDocRoot !== docRootBe) continue;
      if (isIgnoredBackendNode?.(be)) continue;

      // Translate absolute XPaths into document-relative ones for this frame.
      const rel = relativizeXPath(baseAbs, nodeAbs);
      const key = enc(be);
      xpathMap[key] = rel;
      const tag = idx.tagByBe.get(be);
      if (tag) tagNameMap[key] = tag;
      if (idx.scrollByBe.get(be)) scrollableMap[key] = true;
    }

    const { outline, urlMap } = await a11yForFrame(sess, frameId, {
      isIgnoredBackendNode,
      experimental: options?.experimental ?? false,
      tagNameMap,
      scrollableMap,
      encode: (backendNodeId) => `${page.getOrdinal(frameId)}-${backendNodeId}`,
    });

    perFrameOutlines.push({ frameId, outline });
    perFrameMaps.set(frameId, { tagNameMap, xpathMap, scrollableMap, urlMap });
  }

  return { perFrameMaps, perFrameOutlines };
}

export async function resolveIgnoredNodes(
  page: Page,
  ignoreSelectors: string[] | undefined,
  context: FrameContext,
  sessionToIndex: Map<string, SessionDomIndex>,
): Promise<IgnoredNodeMap> {
  const ignoredNodesByFrame: IgnoredNodeMap = new Map();

  for (const rawSelector of ignoreSelectors ?? []) {
    const selector = rawSelector.trim();
    if (!selector) continue;

    try {
      const resolved = await resolveIgnoredNodesForSelector(
        page,
        selector,
        context,
        sessionToIndex,
      );
      for (const match of resolved) {
        const nodes =
          ignoredNodesByFrame.get(match.frameId) ?? new Set<number>();
        nodes.add(match.backendNodeId);
        ignoredNodesByFrame.set(match.frameId, nodes);
      }
    } catch {
      continue;
    }
  }

  return ignoredNodesByFrame;
}

async function resolveIgnoredNodesForSelector(
  page: Page,
  selector: string,
  context: FrameContext,
  sessionToIndex: Map<string, SessionDomIndex>,
): Promise<Array<{ frameId: string; backendNodeId: number }>> {
  const looksLikeXPath = /^xpath=/i.test(selector) || selector.startsWith("/");

  if (looksLikeXPath) {
    const hit = await resolveFocusFrameAndTail(
      page,
      normalizeXPath(selector),
      context.parentByFrame,
      context.rootId,
    );
    const targetFrameId = hit.targetFrameId;
    const tailXPath = hit.tailXPath || "/";
    if (tailXPath === "/") {
      const idx = ownerSessionIndexForFrame(
        page,
        targetFrameId,
        sessionToIndex,
      );
      if (!idx) return [];
      const parentId = context.parentByFrame.get(targetFrameId);
      const sameSessionAsParent =
        !!parentId &&
        ownerSession(page, parentId) === ownerSession(page, targetFrameId);
      const backendNodeId = await resolveFrameDocRootBackendId(
        page,
        targetFrameId,
        idx,
        sameSessionAsParent,
      );
      return [{ frameId: targetFrameId, backendNodeId }];
    }
    return resolveIgnoredNodesInFrame(page, targetFrameId, {
      kind: "xpath",
      value: tailXPath,
    });
  }

  const hit = await resolveCssFocusFrameAndTail(
    page,
    selector,
    context.parentByFrame,
    context.rootId,
  );
  const targetFrameId = hit.targetFrameId;
  return resolveIgnoredNodesInFrame(page, targetFrameId, {
    kind: "css",
    value: hit.tailSelector || selector,
  });
}

async function resolveIgnoredNodesInFrame(
  page: Page,
  frameId: string,
  query: SelectorQuery,
): Promise<Array<{ frameId: string; backendNodeId: number }>> {
  const session = ownerSession(page, frameId);
  const frame = new Frame(session, frameId, "", false);
  const resolver = new FrameSelectorResolver(frame);
  const resolvedNodes = await resolver.resolveAll(query);
  if (!resolvedNodes.length) return [];

  const backendNodeIds = await describeResolvedNodes(session, resolvedNodes);
  return backendNodeIds.map((backendNodeId) => ({ frameId, backendNodeId }));
}

async function describeResolvedNodes(
  session: CDPSessionLike,
  resolvedNodes: ResolvedNode[],
): Promise<number[]> {
  const backendNodeIds = new Set<number>();

  try {
    for (const resolvedNode of resolvedNodes) {
      const desc = await session.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId: resolvedNode.objectId },
      );
      const backendNodeId = desc.node.backendNodeId;
      if (typeof backendNodeId === "number") {
        backendNodeIds.add(backendNodeId);
      }
    }
  } finally {
    await Promise.all(
      resolvedNodes.map((resolvedNode) =>
        session
          .send("Runtime.releaseObject", { objectId: resolvedNode.objectId })
          .catch(() => {}),
      ),
    );
  }

  return [...backendNodeIds];
}

export async function buildFrameExclusionIntervals(
  page: Page,
  context: FrameContext,
  sessionToIndex: Map<string, SessionDomIndex>,
  ignoredNodesByFrame: IgnoredNodeMap,
): Promise<ExclusionIntervalsByFrame> {
  const intervalsByFrame: ExclusionIntervalsByFrame = new Map();
  if (!ignoredNodesByFrame.size) return intervalsByFrame;
  const childFramesByParent = await resolveChildFramesByParent(page, context);
  const excludedFrames = new Set<string>();

  const pushInterval = (frameId: string, start: number, end: number) => {
    const intervals = intervalsByFrame.get(frameId) ?? [];
    intervals.push({ start, end });
    intervalsByFrame.set(frameId, intervals);
  };

  const excludeFrameSubtree = async (frameId: string): Promise<void> => {
    if (excludedFrames.has(frameId)) return;
    excludedFrames.add(frameId);

    const idx = ownerSessionIndexForFrame(page, frameId, sessionToIndex);
    if (!idx) return;
    const parentId = context.parentByFrame.get(frameId);
    const sameSessionAsParent =
      !!parentId &&
      ownerSession(page, parentId) === ownerSession(page, frameId);
    const docRootBe = await resolveFrameDocRootBackendId(
      page,
      frameId,
      idx,
      sameSessionAsParent,
    );
    const start = idx.enterByBe.get(docRootBe);
    const end = idx.exitByBe.get(docRootBe);
    if (typeof start === "number" && typeof end === "number") {
      pushInterval(frameId, start, end);
    }

    for (const childFrameId of listChildrenOf(context.parentByFrame, frameId)) {
      await excludeFrameSubtree(childFrameId);
    }
  };

  const excludeIgnoredNode = async (
    frameId: string,
    backendNodeId: number,
  ): Promise<void> => {
    const idx = ownerSessionIndexForFrame(page, frameId, sessionToIndex);
    if (!idx) return;
    const start = idx.enterByBe.get(backendNodeId);
    const end = idx.exitByBe.get(backendNodeId);
    if (typeof start !== "number" || typeof end !== "number") return;

    pushInterval(frameId, start, end);
    for (const childFrame of childFramesByParent.get(frameId) ?? []) {
      const hostEnter = idx.enterByBe.get(childFrame.hostBackendNodeId);
      if (typeof hostEnter !== "number") continue;
      if (hostEnter < start || hostEnter > end) continue;
      await excludeFrameSubtree(childFrame.childFrameId);
    }
  };

  for (const [frameId, backendNodeIds] of ignoredNodesByFrame.entries()) {
    for (const backendNodeId of backendNodeIds) {
      await excludeIgnoredNode(frameId, backendNodeId);
    }
  }

  for (const [frameId, intervals] of intervalsByFrame.entries()) {
    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Interval[] = [];
    for (const interval of intervals) {
      const prev = merged[merged.length - 1];
      if (!prev || interval.start > prev.end) {
        merged.push({ ...interval });
        continue;
      }
      if (interval.end > prev.end) prev.end = interval.end;
    }
    intervalsByFrame.set(frameId, merged);
  }

  return intervalsByFrame;
}

async function resolveChildFramesByParent(
  page: Page,
  context: FrameContext,
): Promise<ChildFramesByParent> {
  const childFramesByParent: ChildFramesByParent = new Map();

  for (const frameId of context.frames) {
    const parentId = context.parentByFrame.get(frameId);
    if (!parentId) continue;

    const session = parentSession(page, context.parentByFrame, frameId);
    if (!session) continue;

    try {
      const { backendNodeId } = await session.send<{ backendNodeId?: number }>(
        "DOM.getFrameOwner",
        { frameId },
      );
      if (typeof backendNodeId !== "number") continue;
      const childFrames = childFramesByParent.get(parentId) ?? [];
      childFrames.push({
        childFrameId: frameId,
        hostBackendNodeId: backendNodeId,
      });
      childFramesByParent.set(parentId, childFrames);
    } catch {
      continue;
    }
  }

  return childFramesByParent;
}

function makeIsIgnoredBackendNode(
  frameId: string,
  idx: SessionDomIndex | undefined,
  exclusionIntervalsByFrame: ExclusionIntervalsByFrame,
): ((backendNodeId: number) => boolean) | undefined {
  if (!idx) return undefined;
  const intervals = exclusionIntervalsByFrame.get(frameId);
  if (!intervals?.length) return undefined;

  return (backendNodeId: number): boolean => {
    const enter = idx.enterByBe.get(backendNodeId);
    if (typeof enter !== "number") return false;

    let lo = 0;
    let hi = intervals.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const interval = intervals[mid]!;
      if (enter < interval.start) {
        hi = mid - 1;
      } else if (enter > interval.end) {
        lo = mid + 1;
      } else {
        return true;
      }
    }
    return false;
  };
}

function parseEncodedBackendNodeId(encodedId: string): number | undefined {
  const parts = encodedId.split("-");
  if (parts.length !== 2) return undefined;
  const backendNodeId = Number(parts[1]);
  return Number.isFinite(backendNodeId) ? backendNodeId : undefined;
}

function ownerSessionIndexForFrame(
  page: Page,
  frameId: string,
  sessionToIndex: Map<string, SessionDomIndex>,
): SessionDomIndex | undefined {
  const session = ownerSession(page, frameId);
  return sessionToIndex.get(session.id ?? "root");
}

async function resolveFrameDocRootBackendId(
  page: Page,
  frameId: string,
  idx: SessionDomIndex,
  sameSessionAsParent: boolean,
): Promise<number> {
  if (!sameSessionAsParent) return idx.rootBackend;
  const session = ownerSession(page, frameId);
  try {
    const { backendNodeId } = await session.send<{ backendNodeId?: number }>(
      "DOM.getFrameOwner",
      { frameId },
    );
    if (typeof backendNodeId === "number") {
      const docRootBe = idx.contentDocRootByIframe.get(backendNodeId);
      if (typeof docRootBe === "number") return docRootBe;
    }
  } catch {
    //
  }
  return idx.rootBackend;
}

/**
 * Step 4 – walk the frame tree (parent-first) to compute absolute prefixes for
 * every frame. The prefix is the absolute XPath of the iframe element hosting
 * the frame, so we can later convert relative XPaths into cross-frame ones.
 */
export async function computeFramePrefixes(
  page: Page,
  context: FrameContext,
  perFrameMaps: Map<string, FrameDomMaps>,
  frameIds: string[],
): Promise<{
  absPrefix: Map<string, string>;
  iframeHostEncByChild: Map<string, string>;
}> {
  const absPrefix = new Map<string, string>();
  const iframeHostEncByChild = new Map<string, string>();
  absPrefix.set(context.rootId, "");
  const included = new Set(frameIds);

  const queue: string[] = [];
  if (included.has(context.rootId)) {
    queue.push(context.rootId);
  }

  while (queue.length) {
    const parent = queue.shift()!;
    const parentAbs = absPrefix.get(parent)!;

    for (const child of context.frames) {
      if (!included.has(child)) continue;
      if (context.parentByFrame.get(child) !== parent) continue;
      queue.push(child);

      const parentSess = parentSession(page, context.parentByFrame, child);

      const ownerBackendNodeId = await (async () => {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId?: number;
          }>("DOM.getFrameOwner", { frameId: child });
          return backendNodeId;
        } catch {
          return undefined;
        }
      })();

      if (!ownerBackendNodeId) {
        // OOPIFs resolved via a different session inherit the parent prefix.
        absPrefix.set(child, parentAbs);
        continue;
      }

      const parentDom = perFrameMaps.get(parent);
      const iframeEnc = `${page.getOrdinal(parent)}-${ownerBackendNodeId}`;
      const iframeXPath = parentDom?.xpathMap[iframeEnc];

      const childAbs = iframeXPath
        ? prefixXPath(parentAbs || "/", iframeXPath)
        : parentAbs;

      absPrefix.set(child, childAbs);
      iframeHostEncByChild.set(child, iframeEnc);
    }
  }

  return { absPrefix, iframeHostEncByChild };
}

/**
 * Step 5 – merge per-frame maps into the combined snapshot payload. We prefix
 * each frame's relative XPaths with the absolute path collected in step 4,
 * merge URL maps, and stitch text outlines by nesting child trees under the
 * encoded id of their parent iframe host.
 */
export function mergeFramesIntoSnapshot(
  context: FrameContext,
  perFrameMaps: Map<string, FrameDomMaps>,
  perFrameOutlines: Array<{ frameId: string; outline: string }>,
  absPrefix: Map<string, string>,
  iframeHostEncByChild: Map<string, string>,
  frameIds: string[],
): HybridSnapshot {
  const combinedXpathMap: Record<string, string> = {};
  const combinedUrlMap: Record<string, string> = {};

  for (const frameId of frameIds) {
    const maps = perFrameMaps.get(frameId);
    if (!maps) continue;

    const abs = absPrefix.get(frameId) ?? "";
    const isRoot = abs === "" || abs === "/";

    if (isRoot) {
      Object.assign(combinedXpathMap, maps.xpathMap);
      Object.assign(combinedUrlMap, maps.urlMap);
      continue;
    }

    for (const [encId, xp] of Object.entries(maps.xpathMap)) {
      combinedXpathMap[encId] = prefixXPath(abs, xp);
    }
    Object.assign(combinedUrlMap, maps.urlMap);
  }

  const idToTree = new Map<string, string>();
  for (const { frameId, outline } of perFrameOutlines) {
    const parentEnc = iframeHostEncByChild.get(frameId);
    // The key is the parent iframe's encoded id so injectSubtrees can nest lines.
    if (parentEnc) idToTree.set(parentEnc, outline);
  }

  const rootOutline =
    perFrameOutlines.find((o) => o.frameId === context.rootId)?.outline ??
    perFrameOutlines[0]?.outline ??
    "";
  const combinedTree = injectSubtrees(rootOutline, idToTree);

  return {
    combinedTree,
    combinedXpathMap,
    combinedUrlMap,
    perFrame: perFrameOutlines.map(({ frameId, outline }) => {
      const maps = perFrameMaps.get(frameId);
      return {
        frameId,
        outline,
        xpathMap: maps?.xpathMap ?? {},
        urlMap: maps?.urlMap ?? {},
      };
    }),
  };
}
