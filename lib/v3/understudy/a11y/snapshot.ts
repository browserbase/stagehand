// lib/v3/understudy/a11y/snapshot.ts
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../cdp";
import { Page } from "../page";
import { executionContexts } from "../executionContextRegistry";

/**
 * a11y/snapshot
 *
 * Purpose:
 * Build a **hybrid DOM + Accessibility** snapshot for a V3 `Page`, suitable for
 * act/extract/observe handlers. The snapshot includes:
 *  - A merged, human-readable outline (Accessibility tree) for the page
 *  - EncodedId → XPath map (DOM)
 *  - EncodedId → URL map (from AX properties)
 *
 * Design highlights:
 *  - EncodedId is frame-aware and compact: `${frameOrdinal}-${backendNodeId}` where
 *    the frame ordinal is provided by `Page.getOrdinal(frameId)`.
 *  - Each frame (main, same-process iframe, OOPIF) is processed against **its owning session**,
 *    so DOM and A11y ownership are correct for that document.
 *  - We compute an **absolute iframe XPath prefix** for each child frame by asking
 *    the **parent session** for the `<iframe>` owner node (via `DOM.getFrameOwner`).
 *  - No global inventory imports; we rely solely on Page’s registry-backed APIs.
 */

export type SnapshotOptions = {
  /**
   * Filter the snapshot to a specific element/subtree using a selector that can cross iframes.
   * Supports:
   *  - XPath: strings starting with 'xpath=' or '/'
   *  - CSS with iframe hops via '>>': e.g., 'section iframe >> #email'
   */
  focusSelector?: string;
  /** Pierce shadow DOM in DOM.getDocument (default: true). */
  pierceShadow?: boolean;
  /** Experimental behaviours flag. */
  experimental?: boolean;
};

export type HybridSnapshot = {
  /** Merged/stitched outline across frames. */
  combinedTree: string;
  /** EncodedId (ordinal-backendId) → absolute XPath (across iframes). */
  combinedXpathMap: Record<string, string>;
  /** EncodedId → URL (from AX properties). */
  combinedUrlMap: Record<string, string>;
  /** Per-frame details for debugging/consumers. */
  perFrame?: Array<{
    frameId: string;
    outline: string;
    xpathMap: Record<string, string>;
    urlMap: Record<string, string>;
  }>;
};

/**
 * Compute an absolute XPath for a given backendNodeId within a specific frame.
 * Uses the existing hybrid snapshot machinery to ensure iframe-aware paths.
 */
export async function computeAbsoluteXPathForNode(
  page: Page,
  frameId: string,
  backendNodeId: number,
): Promise<string | null> {
  const snap = await captureHybridSnapshot(page);
  const encId = `${page.getOrdinal(frameId)}-${backendNodeId}`;
  return snap.combinedXpathMap[encId] ?? null;
}

/**
 * Resolve the deepest node at the given page coordinates, traversing into
 * same-process iframes and OOPIFs by mapping the iframe host element to the
 * child frame and translating coordinates into the child viewport space.
 */
export async function resolveNodeForLocationDeep(
  page: Page,
  x: number,
  y: number,
): Promise<{ frameId: string; backendNodeId: number } | null> {
  // Build a parent map from the unified frame tree maintained by Page.
  // This lets us map an <iframe> host element to its child frame id.
  const tree = page.getFullFrameTree();
  const parentByFrame = new Map<string, string | null>();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(tree, null);

  // Current traversal state: start at the main frame in the top-level session.
  let curFrameId = page.mainFrameId();
  let curSession = page.getSessionForFrame(curFrameId);
  let curX = x; // coordinates relative to current frame's viewport
  let curY = y;

  for (let depth = 0; depth < 8; depth++) {
    try {
      await curSession.send("DOM.enable").catch(() => {});

      // Convert viewport → document coordinates for this frame by adding scroll offsets.
      // DOM.getNodeForLocation expects document-based CSS pixels.
      let sx = 0;
      let sy = 0;
      try {
        await curSession.send("Runtime.enable").catch(() => {});
        const ctxId = await executionContexts
          .waitForMainWorld(curSession, curFrameId)
          .catch(() => {});
        if (ctxId) {
          const { result } = await curSession.send<{
            result: { value?: { sx?: number; sy?: number } };
          }>("Runtime.evaluate", {
            contextId: ctxId,
            expression:
              "({sx:(window.scrollX||window.pageXOffset||0),sy:(window.scrollY||window.pageYOffset||0)})",
            returnByValue: true,
          });
          sx = Number(result?.value?.sx ?? 0);
          sy = Number(result?.value?.sy ?? 0);
        } else {
          // Fallback: evaluate without explicit context
          const { result } = await curSession.send<{
            result: { value?: { sx?: number; sy?: number } };
          }>("Runtime.evaluate", {
            expression:
              "({sx:(window.scrollX||window.pageXOffset||0),sy:(window.scrollY||window.pageYOffset||0)})",
            returnByValue: true,
          });
          sx = Number(result?.value?.sx ?? 0);
          sy = Number(result?.value?.sy ?? 0);
        }
      } catch {
        // best-effort; leave sx/sy as 0 if reading fails
      }
      const xDoc = curX + sx;
      const yDoc = curY + sy;
      // Floor to integer CSS pixels as required by CDP
      const xi = Math.max(0, Math.floor(xDoc));
      const yi = Math.max(0, Math.floor(yDoc));

      // Hit-test within the current frame's owning session using document coordinates.
      let res: { backendNodeId?: number; frameId?: string } | undefined;
      try {
        res = await curSession.send<{
          backendNodeId?: number;
          frameId?: string;
        }>("DOM.getNodeForLocation", {
          x: xi,
          y: yi,
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: false,
        });
      } catch {
        return null;
      }

      const be = res?.backendNodeId;
      const reportedFrameId = res?.frameId;

      // If CDP reports the concrete frame id and it differs, return that hit directly.
      if (
        typeof be === "number" &&
        reportedFrameId &&
        reportedFrameId !== curFrameId
      )
        return { frameId: reportedFrameId, backendNodeId: be };

      if (typeof be !== "number") {
        return null;
      }

      // Check if the hit node is an <iframe> host for any child frame; if not, we are done.
      let matchedChild: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, curFrameId)) {
        try {
          const { backendNodeId } = await curSession.send<{
            backendNodeId?: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === be) {
            matchedChild = fid;
            break;
          }
        } catch {
          // ignore and try next child
        }
      }

      if (!matchedChild) {
        // Not an iframe host → final hit inside current frame.
        return { frameId: curFrameId, backendNodeId: be };
      }

      // Translate coordinates into the child's viewport by subtracting the
      // parent's iframe element bounding rect, then continue traversal in the child.
      let left = 0;
      let top = 0;
      try {
        const { object } = await curSession.send<{
          object: { objectId?: string };
        }>("DOM.resolveNode", { backendNodeId: be });
        const objectId = object?.objectId;
        if (objectId) {
          const { result } = await curSession.send<{
            result: { value?: { left: number; top: number } };
          }>("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration:
              "function(){ const r=this.getBoundingClientRect(); return {left:r.left, top:r.top}; }",
            returnByValue: true,
          });
          left = Number(result?.value?.left ?? 0);
          top = Number(result?.value?.top ?? 0);
          await curSession
            .send("Runtime.releaseObject", { objectId })
            .catch(() => {});
        }
      } catch {
        // fall through with 0,0 offset
      }

      curX = Math.max(0, curX - left);
      curY = Math.max(0, curY - top);
      curFrameId = matchedChild;
      curSession = page.getSessionForFrame(curFrameId);
    } catch {
      return null;
    }
  }
  return null;
}

export async function captureHybridSnapshot(
  page: Page,
  options?: SnapshotOptions,
): Promise<HybridSnapshot> {
  const pierce = options?.pierceShadow ?? true;

  // Topology (root-first) from Page/FrameRegistry
  const rootId = page.mainFrameId();
  const frameTree = page.asProtocolFrameTree(rootId);

  // parent[child] = parent | null
  const parentByFrame = new Map<string, string | null>();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(frameTree, null);

  // DFS order (root-first) so parent prefixes are known before children
  const frames = page.listAllFrameIds();

  // Output maps
  const combinedXpathMap: Record<string, string> = {};
  const combinedUrlMap: Record<string, string> = {};
  const perFrameOutlines: Array<{ frameId: string; outline: string }> = [];

  // Per-frame (DOM + URL) stash before prefixing
  const perFrameMaps = new Map<
    string,
    {
      tagNameMap: Record<string, string>;
      xpathMap: Record<string, string>;
      scrollableMap: Record<string, boolean>;
      urlMap: Record<string, string>;
    }
  >();

  // If focusSelector provided, try to traverse into the correct frame first and
  // scope the snapshot to that frame + (optional) subtree. This avoids building
  // the full-tree and trimming after.
  const requestedFocus = options?.focusSelector?.trim();
  if (requestedFocus) {
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
          parentByFrame,
          rootId,
        );
        targetFrameId = hit.targetFrameId;
        tailSelector = hit.tailXPath || undefined;
        absPrefix = hit.absPrefix;
      } else {
        const cssHit = await resolveCssFocusFrameAndTail(
          page,
          requestedFocus,
          parentByFrame,
          rootId,
        );
        targetFrameId = cssHit.targetFrameId;
        tailSelector = cssHit.tailSelector || undefined;
        absPrefix = cssHit.absPrefix;
      }

      // Build DOM + A11y just for the target frame (more efficient)
      const owningSess = ownerSession(page, targetFrameId);
      const parentId = parentByFrame.get(targetFrameId);
      const sameSessionAsParent =
        !!parentId &&
        ownerSession(page, parentId) === ownerSession(page, targetFrameId);
      const { tagNameMap, xpathMap, scrollableMap } = await domMapsForSession(
        owningSess,
        targetFrameId,
        pierce,
        (fid, be) => `${page.getOrdinal(fid)}-${be}`,
        /*attemptOwnerLookup=*/ sameSessionAsParent,
      );

      const { outline, urlMap } = await a11yForFrame(
        owningSess,
        targetFrameId,
        {
          focusSelector: tailSelector || undefined,
          tagNameMap,
          experimental: options?.experimental ?? false,
          scrollableMap,
          encode: (backendNodeId) =>
            `${page.getOrdinal(targetFrameId)}-${backendNodeId}`,
        },
      );

      // Prefix XPaths with the absolute iframe chain we traversed
      const combinedXpathMap: Record<string, string> = {};
      const abs = absPrefix ?? "";
      const isRoot = !abs || abs === "/";
      if (isRoot) {
        Object.assign(combinedXpathMap, xpathMap);
      } else {
        for (const [encId, xp] of Object.entries(xpathMap)) {
          combinedXpathMap[encId] = prefixXPath(abs, xp);
        }
      }

      const combinedUrlMap: Record<string, string> = { ...urlMap };

      return {
        combinedTree: outline,
        combinedXpathMap,
        combinedUrlMap,
        perFrame: [
          {
            frameId: targetFrameId,
            outline,
            xpathMap,
            urlMap,
          },
        ],
      };
    } catch {
      // If traversal fails for any reason, fall back to full snapshot below.
    }
  }

  // ============== 1) Build per-session DOM once, then slice per frame ==============
  type SessionDomIndex = {
    rootBackend: number;
    absByBe: Map<number, string>;
    tagByBe: Map<number, string>;
    scrollByBe: Map<number, boolean>;
    /** Maps each backend node to its document root backend id (contentDocument root). */
    docRootOf: Map<number, number>;
    /** For iframe elements, contentDocument root backend id. */
    contentDocRootByIframe: Map<number, number>;
  };

  async function buildSessionDomIndex(
    session: CDPSessionLike,
    pierce: boolean,
  ): Promise<SessionDomIndex> {
    await session.send("DOM.enable").catch(() => {});
    const { root } = await session.send<{ root: Protocol.DOM.Node }>(
      "DOM.getDocument",
      { depth: -1, pierce },
    );

    const absByBe = new Map<number, string>();
    const tagByBe = new Map<number, string>();
    const scrollByBe = new Map<number, boolean>();
    const docRootOf = new Map<number, number>();
    const contentDocRootByIframe = new Map<number, number>();

    type Entry = { node: Protocol.DOM.Node; xp: string; docRootBe: number };
    const rootBe = root.backendNodeId!;
    const stack: Entry[] = [{ node: root, xp: "/", docRootBe: rootBe }];

    while (stack.length) {
      const { node, xp, docRootBe } = stack.pop()!;
      if (node.backendNodeId) {
        absByBe.set(node.backendNodeId, xp || "/");
        tagByBe.set(node.backendNodeId, String(node.nodeName).toLowerCase());
        if (node?.isScrollable === true)
          scrollByBe.set(node.backendNodeId, true);
        docRootOf.set(node.backendNodeId, docRootBe);
      }

      const kids = node.children ?? [];
      if (kids.length) {
        const segs = buildChildXPathSegments(kids);
        for (let i = kids.length - 1; i >= 0; i--) {
          const child = kids[i]!;
          const step = segs[i]!;
          stack.push({ node: child, xp: joinXPath(xp, step), docRootBe });
        }
      }

      for (const sr of node.shadowRoots ?? []) {
        stack.push({ node: sr, xp: joinXPath(xp, "//"), docRootBe });
      }

      const cd = node.contentDocument as Protocol.DOM.Node | undefined;
      if (cd && typeof cd.backendNodeId === "number") {
        contentDocRootByIframe.set(node.backendNodeId!, cd.backendNodeId);
        // Descend into contentDocument without changing the visible XPath (doc root shares the iframe's path)
        stack.push({ node: cd, xp, docRootBe: cd.backendNodeId });
      }
    }

    return {
      rootBackend: rootBe,
      absByBe,
      tagByBe,
      scrollByBe,
      docRootOf,
      contentDocRootByIframe,
    };
  }

  function relativizeXPath(baseAbs: string, nodeAbs: string): string {
    const base = normalizeXPath(baseAbs);
    const abs = normalizeXPath(nodeAbs);
    if (abs === base) return "/";
    if (abs.startsWith(base)) {
      const tail = abs.slice(base.length);
      if (!tail) return "/";
      return tail.startsWith("/") || tail.startsWith("//") ? tail : `/${tail}`;
    }
    // Fallback: if base is root
    if (base === "/") return abs;
    return abs; // do not drop node; keep absolute as best effort
  }

  // Build indices once per unique session
  const uniqueSessions: CDPSessionLike[] = [];
  const sessionToIndex = new Map<CDPSessionLike, SessionDomIndex>();
  for (const frameId of frames) {
    const sess = ownerSession(page, frameId);
    if (!uniqueSessions.includes(sess)) uniqueSessions.push(sess);
  }
  for (const sess of uniqueSessions) {
    const idx = await buildSessionDomIndex(sess, pierce);
    sessionToIndex.set(sess, idx);
  }

  // Slice per-frame maps from session indices
  for (const frameId of frames) {
    const sess = ownerSession(page, frameId);
    const idx = sessionToIndex.get(sess)!;

    // Determine the document root for this frame within this session
    const parentId = parentByFrame.get(frameId);
    const sameSessionAsParent =
      !!parentId && ownerSession(page, parentId) === sess;
    let docRootBe = idx.rootBackend;
    if (sameSessionAsParent) {
      try {
        const { backendNodeId } = await sess.send<{ backendNodeId?: number }>(
          "DOM.getFrameOwner",
          { frameId },
        );
        if (typeof backendNodeId === "number") {
          const cdBe = idx.contentDocRootByIframe.get(backendNodeId);
          if (typeof cdBe === "number") docRootBe = cdBe;
        }
      } catch {
        // fall back to session root
      }
    }

    const tagNameMap: Record<string, string> = {};
    const xpathMap: Record<string, string> = {};
    const scrollableMap: Record<string, boolean> = {};
    const enc = (be: number) => `${page.getOrdinal(frameId)}-${be}`;
    const baseAbs = idx.absByBe.get(docRootBe) ?? "/";

    for (const [be, nodeAbs] of idx.absByBe.entries()) {
      const nodeDocRoot = idx.docRootOf.get(be);
      if (nodeDocRoot !== docRootBe) continue; // keep nodes within this document only

      const rel = relativizeXPath(baseAbs, nodeAbs);
      const key = enc(be);
      xpathMap[key] = rel;
      const tag = idx.tagByBe.get(be);
      if (tag) tagNameMap[key] = tag;
      if (idx.scrollByBe.get(be)) scrollableMap[key] = true;
    }

    // Build A11y tree (once per frame)
    const { outline, urlMap } = await a11yForFrame(sess, frameId, {
      experimental: options?.experimental ?? false,
      tagNameMap,
      scrollableMap,
      encode: (backendNodeId) => `${page.getOrdinal(frameId)}-${backendNodeId}`,
    });

    perFrameOutlines.push({ frameId, outline });
    perFrameMaps.set(frameId, { tagNameMap, xpathMap, scrollableMap, urlMap });
  }

  // ============== 2) Compute absolute iframe prefixes top-down ==============
  // frameId -> absolute XPath of the iframe element hosting this frame
  const absPrefix = new Map<string, string>();
  const iframeHostEncByChild = new Map<string, string>();
  absPrefix.set(rootId, ""); // root has no prefix

  const queue: string[] = [rootId];
  while (queue.length) {
    const parent = queue.shift()!;
    const parentAbs = absPrefix.get(parent)!;

    for (const child of frames) {
      if (parentByFrame.get(child) !== parent) continue;
      queue.push(child);

      // The **only correct session** for DOM.getFrameOwner(child) is the parent's session
      const parentSess = parentSession(page, parentByFrame, child);

      const ownerBackendNodeId = await (async () => {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId?: number;
          }>("DOM.getFrameOwner", { frameId: child });
          return backendNodeId;
        } catch {
          return undefined; // OOPIF child or race → inherit parentAbs below
        }
      })();

      if (!ownerBackendNodeId) {
        // Couldn’t resolve owner in parent → default to inheriting the parent’s prefix
        absPrefix.set(child, parentAbs);
        continue;
      }

      // Look up the absolute XPath for the iframe element in the parent’s per-frame map
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

  // ============== 3) Merge frames into global maps using absolute prefixes ==============
  for (const frameId of frames) {
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

  // Stitch child outlines under their parent iframe lines (optional)
  const idToTree = new Map<string, string>();
  for (const { frameId, outline } of perFrameOutlines) {
    const parentEnc = iframeHostEncByChild.get(frameId);
    if (parentEnc) idToTree.set(parentEnc, outline);
  }

  const rootOutline =
    perFrameOutlines.find((o) => o.frameId === rootId)?.outline ??
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

/**
 * Prefix `child` XPath with an absolute iframe path `parentAbs`.
 * Handles root slashes and shadow hops (“//”) cleanly.
 */
function prefixXPath(parentAbs: string, child: string): string {
  const p = parentAbs === "/" ? "" : parentAbs.replace(/\/$/, "");
  if (!child || child === "/") return p || "/";
  if (child.startsWith("//"))
    return p ? `${p}//${child.slice(2)}` : `//${child.slice(2)}`;
  const c = child.replace(/^\//, "");
  return p ? `${p}/${c}` : `/${c}`;
}

/** Normalize an XPath: strip `xpath=`, ensure leading '/', remove trailing '/'. */
function normalizeXPath(x?: string): string {
  if (!x) return "";
  let s = x.trim().replace(/^xpath=/i, "");
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/* ------------------------------------------------------------------------------------------------
 * Focus traversal helpers (iframe-aware)
 * ----------------------------------------------------------------------------------------------*/

type Axis = "child" | "desc";
type Step = { axis: Axis; raw: string; name: string };
const IFRAME_STEP_RE = /^iframe(?:\[\d+])?$/i;

function parseXPathToSteps(path: string): Step[] {
  const s = path.trim();
  let i = 0;
  const steps: Step[] = [];
  while (i < s.length) {
    let axis: Axis = "child";
    if (s.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (s[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    while (i < s.length && s[i] !== "/") i++;
    const raw = s.slice(start, i).trim();
    if (!raw) continue;
    const name = raw.replace(/\[\d+\]\s*$/u, "").toLowerCase();
    steps.push({ axis, raw, name });
  }
  return steps;
}

function buildXPathFromSteps(steps: ReadonlyArray<Step>): string {
  let out = "";
  for (const st of steps) {
    out += st.axis === "desc" ? "//" : "/";
    out += st.raw;
  }
  return out || "/";
}

/**
 * Given a cross-frame XPath, walk iframe steps to resolve:
 * - the target frameId (last iframe hop)
 * - the tail XPath (within the target frame)
 * - the absolute XPath prefix up to the iframe element hosting that frame
 */
async function resolveFocusFrameAndTail(
  page: Page,
  absoluteXPath: string,
  parentByFrame: Map<string, string | null>,
  rootId: string,
): Promise<{
  targetFrameId: string;
  tailXPath: string;
  absPrefix: string;
}> {
  const steps = parseXPathToSteps(absoluteXPath);
  let ctxFrameId = rootId;
  let buf: Step[] = [];
  let absPrefix = "";

  const flushIntoChild = async (): Promise<void> => {
    if (!buf.length) return;
    const selectorForIframe = buildXPathFromSteps(buf);
    const parentSess = page.getSessionForFrame(ctxFrameId);
    const objectId = await resolveObjectIdForXPath(
      parentSess,
      selectorForIframe,
      ctxFrameId,
    );
    if (!objectId) throw new Error("Failed to resolve iframe element by XPath");

    try {
      await parentSess.send("DOM.enable").catch(() => {});
      const desc = await parentSess.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;

      // Find matching child frame whose owner in the parent session has this backendNodeId
      let childFrameId: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, ctxFrameId)) {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch {
          // ignore and continue
        }
      }
      if (!childFrameId)
        throw new Error("Could not map iframe to child frameId");

      // Update absolute prefix with the iframe element path within the parent document
      absPrefix = prefixXPath(absPrefix || "/", selectorForIframe);
      ctxFrameId = childFrameId;
    } finally {
      await parentSess
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }

    buf = [];
  };

  for (const st of steps) {
    buf.push(st);
    if (IFRAME_STEP_RE.test(st.name)) {
      await flushIntoChild();
    }
  }

  const tailXPath = buildXPathFromSteps(buf);
  return { targetFrameId: ctxFrameId, tailXPath, absPrefix };
}

/** Resolve focus frame and tail CSS selector using '>>' to hop iframes. */
async function resolveCssFocusFrameAndTail(
  page: Page,
  rawSelector: string,
  parentByFrame: Map<string, string | null>,
  rootId: string,
): Promise<{
  targetFrameId: string;
  tailSelector: string;
  absPrefix: string; // best-effort: empty when unknown
}> {
  const parts = rawSelector
    .split(">>")
    .map((s) => s.trim())
    .filter(Boolean);
  let ctxFrameId = rootId;
  const absPrefix = ""; // computing true absolute XPath for CSS hops is non-trivial; leave empty

  // All but last part are iframe element selectors in the current context
  for (let i = 0; i < Math.max(0, parts.length - 1); i++) {
    const parentSess = page.getSessionForFrame(ctxFrameId);
    // Resolve iframe element in parent context using CSS (supports shadow via v3 backdoor)
    const objectId = await resolveObjectIdForCss(
      parentSess,
      parts[i]!,
      ctxFrameId,
    );
    if (!objectId) throw new Error("Failed to resolve iframe via CSS hop");
    try {
      await parentSess.send("DOM.enable").catch(() => {});
      const desc = await parentSess.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        { objectId },
      );
      const iframeBackendNodeId = desc.node.backendNodeId;
      // Map to child frame id via DOM.getFrameOwner across parent's children
      let childFrameId: string | undefined;
      for (const fid of listChildrenOf(parentByFrame, ctxFrameId)) {
        try {
          const { backendNodeId } = await parentSess.send<{
            backendNodeId: number;
          }>("DOM.getFrameOwner", { frameId: fid });
          if (backendNodeId === iframeBackendNodeId) {
            childFrameId = fid;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!childFrameId)
        throw new Error("Could not map CSS iframe hop to child frameId");
      ctxFrameId = childFrameId;
    } finally {
      await parentSess
        .send("Runtime.releaseObject", { objectId })
        .catch(() => {});
    }
  }

  const tailSelector = parts[parts.length - 1] ?? "*";
  return { targetFrameId: ctxFrameId, tailSelector, absPrefix };
}

function listChildrenOf(
  parentByFrame: Map<string, string | null>,
  parentId: string,
): string[] {
  const out: string[] = [];
  for (const [fid, p] of parentByFrame.entries()) {
    if (p === parentId) out.push(fid);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * DOM helpers
 * ----------------------------------------------------------------------------------------------*/

/**
 * Build tag name and XPath maps for a single frame session.
 * EncodedId is produced by a frame-aware encoder: `${ordinal}-${backendId}` by default.
 * For same-process iframes, we scope to the iframe’s `contentDocument` in the **owning session**.
 * For OOPIFs, we start at the **session’s** root document (owner element lives in the parent).
 */
async function domMapsForSession(
  session: CDPSessionLike,
  frameId: string,
  pierce: boolean,
  encode: (fid: string, backendNodeId: number) => string = (fid, be) =>
    `${fid}-${be}`,
  attemptOwnerLookup = true,
): Promise<{
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
}> {
  await session.send("DOM.enable").catch(() => {});
  const { root } = await session.send<{ root: Protocol.DOM.Node }>(
    "DOM.getDocument",
    { depth: -1, pierce },
  );

  // Try to scope to the iframe’s own contentDocument (same-process iframe).
  // In an OOPIF child session, this call is invalid; callers pass attemptOwnerLookup = false.
  let startNode: Protocol.DOM.Node = root;
  if (attemptOwnerLookup) {
    try {
      const owner = await session.send<{ backendNodeId?: number }>(
        "DOM.getFrameOwner",
        { frameId },
      );
      const ownerBackendId = owner.backendNodeId;
      if (typeof ownerBackendId === "number") {
        const ownerEl = findNodeByBackendId(root, ownerBackendId);
        if (ownerEl?.contentDocument) {
          startNode = ownerEl.contentDocument;
        }
      }
    } catch {
      // OOPIF or race → keep startNode = root
    }
  }

  const tagNameMap: Record<string, string> = {};
  const xpathMap: Record<string, string> = {};
  const scrollableMap: Record<string, boolean> = {};

  type StackEntry = { node: Protocol.DOM.Node; xpath: string };
  const stack: StackEntry[] = [{ node: startNode, xpath: "" }];

  while (stack.length) {
    const { node, xpath } = stack.pop()!;

    if (node.backendNodeId) {
      const encId = encode(frameId, node.backendNodeId);
      tagNameMap[encId] = String(node.nodeName).toLowerCase();
      xpathMap[encId] = xpath || "/"; // root of this scoped doc → "/"
      // Mark scrollability if present on the DOM node
      // CDP: Protocol.DOM.Node may include `isScrollable`; guard via `any` for type safety.
      const isScrollable = node?.isScrollable === true;
      if (isScrollable) scrollableMap[encId] = true;
    }

    // Children → per-sibling qualified steps
    const kids = node.children ?? [];
    if (kids.length) {
      const segs = buildChildXPathSegments(kids);
      for (let i = kids.length - 1; i >= 0; i--) {
        const child = kids[i]!;
        const step = segs[i]!;
        stack.push({
          node: child,
          xpath: joinXPath(xpath, step),
        });
      }
    }

    // Shadow roots; keep the // hop marker in the XPath
    for (const sr of node.shadowRoots ?? []) {
      stack.push({
        node: sr,
        xpath: joinXPath(xpath, "//"),
      });
    }

    // IMPORTANT:
    // Do NOT auto-descend into nested iframe contentDocuments here.
    // Each frame is processed in its **own** session scope.
  }

  return { tagNameMap, xpathMap, scrollableMap };
}

function buildChildXPathSegments(kids: Protocol.DOM.Node[]): string[] {
  const segs: string[] = [];
  const ctr: Record<string, number> = {};
  for (const child of kids) {
    const tag = String(child.nodeName).toLowerCase();
    const key = `${child.nodeType}:${tag}`;
    const idx = (ctr[key] = (ctr[key] ?? 0) + 1);
    if (child.nodeType === 3) {
      segs.push(`text()[${idx}]`);
    } else if (child.nodeType === 8) {
      segs.push(`comment()[${idx}]`);
    } else {
      segs.push(
        tag.includes(":") ? `*[name()='${tag}'][${idx}]` : `${tag}[${idx}]`,
      );
    }
  }
  return segs;
}

function joinXPath(base: string, step: string): string {
  // Special-case: a shadow-root hop is represented by "//"
  if (step === "//") {
    if (!base || base === "/") return "//";
    // Avoid creating '///' — if base already ends with '/', just add one '/'
    return base.endsWith("/") ? `${base}/` : `${base}//`;
  }
  if (!base || base === "/") return step ? `/${step}` : "/";
  if (base.endsWith("//")) return `${base}${step}`; // keep double-slash continuity
  if (!step) return base;
  return `${base}/${step}`;
}

/* ------------------------------------------------------------------------------------------------
 * Accessibility helpers
 * ----------------------------------------------------------------------------------------------*/

type A11yNode = {
  role: string;
  name?: string;
  description?: string;
  value?: string | number | boolean;
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  children?: A11yNode[];
  encodedId?: string;
};

type A11yOptions = {
  focusSelector?: string;
  experimental: boolean;
  tagNameMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
  encode: (backendNodeId: number) => string;
};

async function a11yForFrame(
  session: CDPSessionLike,
  frameId: string | undefined,
  opts: A11yOptions,
): Promise<{
  outline: string;
  urlMap: Record<string, string>;
}> {
  await session.send("Accessibility.enable").catch(() => {});
  // Runtime/DOM often already enabled; enable defensively for XPath resolution.
  await session.send("Runtime.enable").catch(() => {});
  await session.send("DOM.enable").catch(() => {});
  // Prefer scoping by frameId, but fall back to session-root when the frame
  // is no longer owned by this target (OOPIF adoption or rapid detach).
  let nodes: Protocol.Accessibility.AXNode[] = [];
  try {
    const params = frameId ? ({ frameId } as Record<string, unknown>) : {};
    ({ nodes } = await session.send<{
      nodes: Protocol.Accessibility.AXNode[];
    }>("Accessibility.getFullAXTree", params));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "");
    const isFrameScopeError =
      msg.includes("Frame with the given") ||
      msg.includes("does not belong to the target") ||
      msg.includes("is not found");
    if (!isFrameScopeError || !frameId) throw e;
    // Retry without frameId against the same session; for OOPIF sessions this
    // returns the AX tree for the child document root, which is what we need.
    ({ nodes } = await session.send<{
      nodes: Protocol.Accessibility.AXNode[];
    }>("Accessibility.getFullAXTree"));
  }

  const urlMap: Record<string, string> = {};
  for (const n of nodes) {
    const be = n.backendDOMNodeId;
    if (typeof be !== "number") continue;
    const url = extractUrlFromAXNode(n);
    if (!url) continue;
    const enc = opts.encode(be);
    urlMap[enc] = url;
  }
  // If focusSelector provided, filter the AX nodes to the subtree rooted at that selector
  const nodesForOutline = await (async () => {
    const sel = opts.focusSelector?.trim();
    if (!sel) return nodes;
    try {
      const looksLikeXPath = /^xpath=/i.test(sel) || sel.startsWith("/");
      const objectId = looksLikeXPath
        ? await resolveObjectIdForXPath(session, sel, frameId)
        : await resolveObjectIdForCss(session, sel, frameId);
      if (!objectId) return nodes;
      const desc = await session.send<{ node?: { backendNodeId?: number } }>(
        "DOM.describeNode",
        { objectId },
      );
      const be = desc.node?.backendNodeId;
      if (typeof be !== "number") return nodes;
      const target = nodes.find((n) => n.backendDOMNodeId === be);
      if (!target) return nodes;
      const keep = new Set<string>([target.nodeId]);
      const queue: Protocol.Accessibility.AXNode[] = [target];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const id of cur.childIds ?? []) {
          if (keep.has(id)) continue;
          keep.add(id);
          const child = nodes.find((n) => n.nodeId === id);
          if (child) queue.push(child);
        }
      }
      return nodes
        .filter((n) => keep.has(n.nodeId))
        .map((n) =>
          n.nodeId === target.nodeId ? { ...n, parentId: undefined } : n,
        );
    } catch {
      return nodes; // fallback to full tree if resolution fails
    }
  })();

  const decorated = decorateRoles(nodesForOutline, opts);
  const { tree } = await buildHierarchicalTree(decorated, opts);

  const simplified = tree.map((n) => formatTreeLine(n)).join("\n");
  return { outline: simplified.trimEnd(), urlMap };
}

/** Resolve an XPath to a Runtime remoteObjectId in the given CDP session. */
async function resolveObjectIdForXPath(
  session: CDPSessionLike,
  xpath: string,
  frameId?: string,
): Promise<string | null> {
  let contextId: number | undefined;
  try {
    if (frameId) {
      contextId = await executionContexts
        .waitForMainWorld(session, frameId, 800)
        .catch(
          () => executionContexts.getMainWorld(session, frameId) ?? undefined,
        );
    }
  } catch {
    contextId = undefined;
  }
  const expr = `(() => {
    const xp = ${JSON.stringify(xpath)};
    try {
      if (window.__stagehandV3__ && typeof window.__stagehandV3__.resolveSimpleXPath === 'function') {
        return window.__stagehandV3__.resolveSimpleXPath(xp);
      }
    } catch {}
    try {
      const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return res.singleNodeValue;
    } catch { return null; }
  })()`;
  const { result, exceptionDetails } = await session.send<{
    result: { objectId?: string | undefined };
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
  }>("Runtime.evaluate", {
    expression: expr,
    returnByValue: false,
    contextId,
    awaitPromise: true,
  });
  if (exceptionDetails) return null;
  return result?.objectId ?? null;
}

/** Resolve a CSS selector (supports '>>' within the same frame only) to a Runtime objectId. */
async function resolveObjectIdForCss(
  session: CDPSessionLike,
  selector: string,
  frameId?: string,
): Promise<string | null> {
  let contextId: number | undefined;
  try {
    if (frameId) {
      contextId = await executionContexts
        .waitForMainWorld(session, frameId, 800)
        .catch(
          () => executionContexts.getMainWorld(session, frameId) ?? undefined,
        );
    }
  } catch {
    contextId = undefined;
  }
  const expr = `(() => {
    const selector = ${JSON.stringify(selector)};
    function queryOpenDeep(root) {
      try {
        const hit = root.querySelector(selector);
        if (hit) return hit;
      } catch {}
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.shadowRoot) {
          const found = queryOpenDeep(n.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    }
    const backdoor = window.__stagehandV3__;
    if (backdoor && typeof backdoor.getClosedRoot === 'function') {
      function* roots() {
        yield document;
        const queue = [];
        try {
          const w = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
          let e; while ((e = w.nextNode())) {
            if (e.shadowRoot) queue.push(e.shadowRoot);
            try { const closed = backdoor.getClosedRoot(e); if (closed) queue.push(closed); } catch {}
          }
        } catch {}
        while (queue.length) {
          const r = queue.shift();
          yield r;
          try {
            const w2 = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
            let e2; while ((e2 = w2.nextNode())) {
              if (e2.shadowRoot) queue.push(e2.shadowRoot);
              try { const closed2 = backdoor.getClosedRoot(e2); if (closed2) queue.push(closed2); } catch {}
            }
          } catch {}
        }
      }
      for (const r of roots()) {
        try { const hit = r.querySelector(selector); if (hit) return hit; } catch {}
      }
      return null;
    }
    return queryOpenDeep(document);
  })()`;
  const { result, exceptionDetails } = await session.send<{
    result: { objectId?: string | undefined };
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
  }>("Runtime.evaluate", {
    expression: expr,
    returnByValue: false,
    contextId,
    awaitPromise: true,
  });
  if (exceptionDetails) return null;
  return result?.objectId ?? null;
}

function decorateRoles(
  nodes: Protocol.Accessibility.AXNode[],
  opts: A11yOptions,
): A11yNode[] {
  const asRole = (n: Protocol.Accessibility.AXNode) =>
    String(n.role?.value ?? "");

  return nodes.map((n) => {
    // Compute encoded id first so we can reference DOM maps
    let encodedId: string | undefined;
    if (typeof n.backendDOMNodeId === "number") {
      try {
        encodedId = opts.encode(n.backendDOMNodeId);
      } catch {
        // ignore encode failures
      }
    }

    // Establish base role label
    let role = asRole(n);

    // Decorate scrollable DOM Node isScrollable: true, or when node corresponds to <html>
    const domIsScrollable = encodedId
      ? opts.scrollableMap[encodedId] === true
      : false;
    const tag = encodedId ? opts.tagNameMap[encodedId] : undefined;
    const isHtmlElement = tag === "html";
    if (domIsScrollable || isHtmlElement) {
      const tagLabel = tag && tag.startsWith("#") ? tag.slice(1) : tag;
      role = tagLabel
        ? `scrollable, ${tagLabel}`
        : `scrollable${role ? `, ${role}` : ""}`;
    }

    return {
      role,
      name: n.name?.value,
      description: n.description?.value,
      value: n.value?.value,
      nodeId: n.nodeId,
      backendDOMNodeId: n.backendDOMNodeId,
      parentId: n.parentId,
      childIds: n.childIds,
      encodedId,
    };
  });
}

async function buildHierarchicalTree(
  nodes: A11yNode[],
  opts: A11yOptions,
): Promise<{ tree: A11yNode[] }> {
  const nodeMap = new Map<string, A11yNode>();

  // Keep named or container nodes and any non-structural role
  for (const n of nodes) {
    const keep =
      !!(n.name && n.name.trim()) ||
      !!(n.childIds && n.childIds.length) ||
      !isStructural(n.role);
    if (!keep) continue;
    nodeMap.set(n.nodeId, { ...n });
  }

  // Wire parent/child edges
  for (const n of nodes) {
    if (!n.parentId) continue;
    const parent = nodeMap.get(n.parentId);
    const cur = nodeMap.get(n.nodeId);
    if (parent && cur) (parent.children ??= []).push(cur);
  }

  // Roots (no parentId)
  const roots = nodes
    .filter((n) => !n.parentId && nodeMap.has(n.nodeId))
    .map((n) => nodeMap.get(n.nodeId)!) as A11yNode[];

  // Prune structural wrappers
  const cleaned = (await Promise.all(roots.map(pruneStructuralSafe))).filter(
    Boolean,
  ) as A11yNode[];

  return { tree: cleaned };

  async function pruneStructuralSafe(node: A11yNode): Promise<A11yNode | null> {
    if (+node.nodeId < 0) return null;

    const children = node.children ?? [];
    if (!children.length) {
      return isStructural(node.role) ? null : node;
    }

    const cleanedKids = (
      await Promise.all(children.map(pruneStructuralSafe))
    ).filter(Boolean) as A11yNode[];

    // Remove StaticText children whose combined text equals the parent's name
    const prunedStatic = removeRedundantStaticTextChildren(node, cleanedKids);

    if (isStructural(node.role)) {
      if (prunedStatic.length === 1) return prunedStatic[0]!;
      if (prunedStatic.length === 0) return null;
    }

    // Replace structural role with actual tag name when known
    let newRole = node.role;
    if ((newRole === "generic" || newRole === "none") && node.encodedId) {
      const tagName = opts.tagNameMap[node.encodedId];
      if (tagName) newRole = tagName;
    }

    // Combobox special-case: treat underlying <select> as role "select"
    if (newRole === "combobox" && node.encodedId) {
      const tagName = opts.tagNameMap[node.encodedId];
      if (tagName === "select") newRole = "select";
    }

    return { ...node, role: newRole, children: prunedStatic };
  }
}

function formatTreeLine(node: A11yNode, level = 0): string {
  const indent = "  ".repeat(level);
  const labelId = node.encodedId ?? node.nodeId;
  const label = `[${labelId}] ${node.role}${node.name ? `: ${cleanText(node.name)}` : ""}`;
  const kids =
    node.children?.map((c) => formatTreeLine(c, level + 1)).join("\n") ?? "";
  return kids ? `${indent}${label}\n${kids}` : `${indent}${label}`;
}

function isStructural(role: string): boolean {
  const r = role?.toLowerCase();
  return r === "generic" || r === "none" || r === "inlinetextbox";
}

function cleanText(input: string): string {
  const PUA_START = 0xe000;
  const PUA_END = 0xf8ff;
  const NBSP = new Set<number>([0x00a0, 0x202f, 0x2007, 0xfeff]);

  let out = "";
  let prevSpace = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= PUA_START && code <= PUA_END) continue;
    if (NBSP.has(code)) {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
      continue;
    }
    out += input[i];
    prevSpace = input[i] === " ";
  }
  return out.trim();
}

function extractUrlFromAXNode(
  ax: Protocol.Accessibility.AXNode,
): string | undefined {
  const props = ax.properties ?? [];
  const urlProp = props.find((p) => p.name === "url");
  const value = urlProp?.value?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Collapse all whitespace runs in a string to a single space without trimming.
 */
function normaliseSpaces(s: string): string {
  let out = "";
  let inWs = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      out += ch;
      inWs = false;
    }
  }
  return out;
}

/**
 * Remove StaticText children whose combined text matches the parent's accessible name.
 */
function removeRedundantStaticTextChildren(
  parent: A11yNode,
  children: A11yNode[],
): A11yNode[] {
  if (!parent.name) return children;
  const parentNorm = normaliseSpaces(parent.name).trim();
  let combined = "";
  for (const c of children) {
    if (c.role === "StaticText" && c.name) {
      combined += normaliseSpaces(c.name).trim();
    }
  }
  if (combined === parentNorm) {
    return children.filter((c) => c.role !== "StaticText");
  }
  return children;
}

/** Find a node by backendNodeId inside a DOM.getDocument tree. */
function findNodeByBackendId(
  root: Protocol.DOM.Node,
  backendNodeId: number,
): Protocol.DOM.Node | undefined {
  const stack: Protocol.DOM.Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.backendNodeId === backendNodeId) return n;
    if (n.children) for (const c of n.children) stack.push(c);
    if (n.shadowRoots) for (const s of n.shadowRoots) stack.push(s);
  }
  return undefined;
}

/**
 * Inject each child frame outline under the parent's iframe node line.
 * Keys in `idToTree` are the parent's **iframe EncodedIds** (e.g., "3-22").
 */
function injectSubtrees(
  rootOutline: string,
  idToTree: Map<string, string>,
): string {
  type Frame = { lines: string[]; i: number };
  const out: string[] = [];
  const visited = new Set<string>();
  const stack: Frame[] = [{ lines: rootOutline.split("\n"), i: 0 }];

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.lines.length) {
      stack.pop();
      continue;
    }

    const raw = top.lines[top.i++];
    out.push(raw);

    const indent = raw.match(/^(\s*)/)?.[1] ?? "";
    const content = raw.slice(indent.length);

    const m = content.match(/^\[([^\]]+)]/);
    if (!m) continue;

    const encId = m[1]!;
    const childOutline = idToTree.get(encId);
    if (!childOutline || visited.has(encId)) continue;

    visited.add(encId);

    const fullyInjectedChild = injectSubtrees(childOutline, idToTree);
    out.push(indentBlock(fullyInjectedChild.trimEnd(), indent + "  "));
  }

  return out.join("\n");
}

function indentBlock(block: string, indent: string): string {
  if (!block) return "";
  return block
    .split("\n")
    .map((line) => (line.length ? indent + line : indent + line))
    .join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Session helpers (registry-backed via Page)
 * ----------------------------------------------------------------------------------------------*/

/** Owning session for a frame (registry-backed via Page). */
function ownerSession(page: Page, frameId: string): CDPSessionLike {
  return page.getSessionForFrame(frameId);
}

/** The only correct session for `DOM.getFrameOwner(child)` is the **parent’s** session. */
function parentSession(
  page: Page,
  parentByFrame: Map<string, string | null>,
  frameId: string,
): CDPSessionLike {
  const parentId = parentByFrame.get(frameId) ?? null;
  if (!parentId) {
    // main frame: asking "owner" for itself; callers only use this in a guarded way
    return page.getSessionForFrame(frameId);
  }
  return page.getSessionForFrame(parentId);
}
