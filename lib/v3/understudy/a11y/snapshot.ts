// lib/v3/understudy/a11y/snapshot.ts
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../cdp";
import { Page } from "../page";

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
 * Key design:
 *  - **EncodedId is frame-aware and compact**: we use `${frameOrdinal}-${backendNodeId}`
 *    where `frameOrdinal` is provided by `Page.getOrdinal(frameId)`. This makes IDs short and
 *    stable (e.g., `[2-62]` instead of a long CDP frame id).
 *  - Each **frame** (main, same-process iframe, OOPIF) is processed in its *own* call so DOM/XPath
 *    ownership is correct for that document. We do **not** descend into `contentDocument` when
 *    walking the DOM, otherwise nodes get attributed to the wrong frame.
 *  - For nested iframes, we compute an **absolute iframe XPath prefix** for each frame top-down
 *    and prefix all child frame XPaths with that multi-hop prefix before merging.
 */

export type SnapshotOptions = {
  /** If provided, filter the A11y tree to this XPath (applied in the root frame). */
  focusXPath?: string;
  /** Use piercing mode for DOM tree (default: true). */
  pierceShadow?: boolean;
  /** Decorate scrollable nodes (placeholder in this version; default: false). */
  detectScrollable?: boolean;
  /** Experimental behaviours flag. */
  experimental?: boolean;
};

export type HybridSnapshot = {
  /** Merged/stitched outline across frames (simple concat; injection can be added). */
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
 * Build a hybrid DOM + A11y snapshot for all frames (main + iframes).
 * - same-process iframes: scoped to the iframe's `contentDocument` in the parent session
 * - OOPIF roots: scoped to the child session's root document
 * - XPaths are prefixed with a multi-hop iframe path so they are absolute across frames
 * - A11y outline shows **ordinal EncodedIds** like `[2-62]`
 */
export async function captureHybridSnapshot(
  page: Page,
  options?: SnapshotOptions,
): Promise<HybridSnapshot> {
  const pierce = options?.pierceShadow ?? true;

  // Frame topology from Page (root-first)
  const rootId = page.mainFrameId();
  const frameTree = page.asProtocolFrameTree(rootId);

  // parent[child] = parent | null
  const parentByFrame = new Map<string, string | null>();
  (function index(n: Protocol.Page.FrameTree, parent: string | null) {
    parentByFrame.set(n.frame.id, parent);
    for (const c of n.childFrames ?? []) index(c, n.frame.id);
  })(frameTree, null);

  // DFS order (root-first)
  const frames = page.listAllFrameIds();

  // Global merged maps
  const combinedXpathMap: Record<string, string> = {};
  const combinedUrlMap: Record<string, string> = {};
  const perFrameOutlines: Array<{ frameId: string; outline: string }> = [];

  // Per-frame stash (DOM + URL)
  const perFrameMaps = new Map<
    string,
    {
      tagNameMap: Record<string, string>;
      xpathMap: Record<string, string>;
      urlMap: Record<string, string>;
    }
  >();

  // 1) Build per-frame DOM + A11y maps (no prefixing yet)
  for (const frameId of frames) {
    const session = page.getSessionForFrame(frameId);
    if (!session) continue;

    // Ordinal-aware encoder: `${ordinal}-${backendId}`
    const enc = (fid: string, be: number) => `${page.getOrdinal(fid)}-${be}`;

    // DOM maps for this frame (scoped to its document root)
    const { tagNameMap, xpathMap } = await domMapsForSession(
      session,
      frameId,
      pierce,
      enc,
    );

    // A11y + URL map (main frame uses {frameId}; OOPIF child uses session root)
    const isOopif = session !== page.mainFrame().session && frameId !== rootId;
    const { outline, urlMap } = await a11yForFrame(
      session,
      isOopif ? undefined : frameId,
      {
        focusXPath: frames[0] === frameId ? options?.focusXPath : undefined,
        tagNameMap,
        experimental: options?.experimental ?? false,
        detectScrollable: options?.detectScrollable ?? false,
        encode: (backendNodeId) => enc(frameId, backendNodeId),
      },
    );

    perFrameOutlines.push({ frameId, outline });
    perFrameMaps.set(frameId, { tagNameMap, xpathMap, urlMap });
  }

  // 2) Compute absolute iframe prefixes top-down (frameId -> absolute XPath of its iframe element)
  const absPrefix = new Map<string, string>();
  absPrefix.set(rootId, ""); // root has no prefix

  // top-down queue
  const queue: string[] = [rootId];
  while (queue.length) {
    const parent = queue.shift()!;
    const parentAbs = absPrefix.get(parent)!;

    // enqueue children & compute each child's absolute prefix
    for (const child of frames) {
      if (parentByFrame.get(child) !== parent) continue;
      queue.push(child);

      const parentSession =
        page.getSessionForFrame(parent) ?? page.mainFrame().session;

      let ownerBackendId: number | undefined;
      try {
        const owner = await parentSession.send<{ backendNodeId?: number }>(
          "DOM.getFrameOwner",
          { frameId: child },
        );
        ownerBackendId = owner.backendNodeId;
      } catch {
        ownerBackendId = undefined;
      }

      // default: if owner not resolved, inherit parent's prefix (best-effort)
      if (!ownerBackendId) {
        absPrefix.set(child, parentAbs);
        continue;
      }

      const parentDom = perFrameMaps.get(parent);
      // Use the SAME encoding as domMapsForSession for the parent doc:
      const iframeEnc = `${page.getOrdinal(parent)}-${ownerBackendId}`;
      const iframeXPath = parentDom?.xpathMap[iframeEnc];

      const childAbs = iframeXPath
        ? prefixXPath(parentAbs || "/", iframeXPath)
        : parentAbs;

      absPrefix.set(child, childAbs);
    }
  }

  // 3) Merge frames into global maps using absolute prefixes
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

  // Combined outline — simple concatenation with an ordinal-based header for each iframe.
  // (We can inject child subtrees under parent iframe nodes as a follow-up enhancement.)
  const combinedTree = perFrameOutlines
    .map((o, i) =>
      i === 0
        ? o.outline
        : `\n\n--- iframe ${page.getOrdinal(o.frameId)} ---\n${o.outline}`,
    )
    .join("");

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
  const c = child.replace(/^\//, "");
  return p ? `${p}/${c}` : `/${c}`;
}

/* ------------------------------------------------------------------------------------------------
 * Internal helpers (DOM)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Build tag name and XPath maps for a single frame session.
 * - EncodedId is produced by a **frame-aware encoder**: `${ordinal}-${backendId}` by default.
 * - For same-process iframes, we scope the walk to the iframe’s `contentDocument` so nodes
 *   belong to the correct frame. For OOPIFs, we start at the session’s root.
 */
async function domMapsForSession(
  session: CDPSessionLike,
  frameId: string,
  pierce: boolean,
  encode: (fid: string, backendNodeId: number) => string = (fid, be) =>
    `${fid}-${be}`,
): Promise<{
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
}> {
  await session.send("DOM.enable").catch(() => {});
  const { root } = await session.send<{ root: Protocol.DOM.Node }>(
    "DOM.getDocument",
    { depth: -1, pierce },
  );

  // Try to scope to the iframe’s own contentDocument (same-process iframe).
  // In an OOPIF child session, this will usually fail (owner lives in parent),
  // so we’ll just start at the root of this session’s document.
  let startNode: Protocol.DOM.Node = root;
  try {
    const owner = await session.send<{ backendNodeId?: number }>(
      "DOM.getFrameOwner",
      { frameId },
    );
    const ownerBackendId = owner.backendNodeId;
    if (typeof ownerBackendId === "number") {
      const ownerEl = findNodeByBackendId(root, ownerBackendId);
      if (ownerEl?.contentDocument) {
        // Scope the walk to this iframe’s document for same-process iframes
        startNode = ownerEl.contentDocument;
      }
      // else: fallback to root (rare)
    }
  } catch {
    // OOPIF or no owner in this session → keep startNode = root
  }

  const tagNameMap: Record<string, string> = {};
  const xpathMap: Record<string, string> = {};

  type StackEntry = { node: Protocol.DOM.Node; xpath: string };
  const stack: StackEntry[] = [{ node: startNode, xpath: "" }];

  while (stack.length) {
    const { node, xpath } = stack.pop()!;

    if (node.backendNodeId) {
      const encId = encode(frameId, node.backendNodeId);
      tagNameMap[encId] = String(node.nodeName).toLowerCase();
      xpathMap[encId] = xpath || "/"; // root of this scoped doc → "/"
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
    // Each frame (same-process or OOPIF) is processed by its own call,
    // so nested frames will be handled when their frameId is processed.
    // if (node.contentDocument) {
    //   stack.push({ node: node.contentDocument, xpath: "" });
    // }
  }

  return { tagNameMap, xpathMap };
}

/**
 * Build XPath steps for a batch of siblings (left→right order).
 */
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

/**
 * Join two XPath parts; treats `//` marker specially (shadow hop).
 */
function joinXPath(base: string, step: string): string {
  if (!base || base === "/") return step ? `/${step}` : "/";
  if (base.endsWith("//")) return `${base}${step}`;
  if (!step) return base;
  return `${base}/${step}`;
}

/* ------------------------------------------------------------------------------------------------
 * Internal helpers (Accessibility)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Minimal shape we operate on after decoration/pruning.
 * - `encodedId` is the **frame-aware, compact** id (`<ordinal>-<backendId>`) used by outlines/maps.
 */
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
  encodedId?: string; // <<— important: shows up in the combined tree as [ordinal-backendId]
};

type A11yOptions = {
  focusXPath?: string;
  detectScrollable: boolean;
  experimental: boolean;
  tagNameMap: Record<string, string>;
  /** Encoder for A11y nodes: transforms backendNodeId into an EncodedId (`<ordinal>-<backendId>`) */
  encode: (backendNodeId: number) => string;
};

/**
 * Fetch and process the Accessibility tree for a single frame.
 * - If `frameId` is provided, the call is scoped to that frame (same-process iframes).
 * - If not, the child session will return its own tree (OOPIF).
 */
async function a11yForFrame(
  session: CDPSessionLike,
  frameId: string | undefined,
  opts: A11yOptions,
): Promise<{
  outline: string;
  urlMap: Record<string, string>;
}> {
  await session.send("Accessibility.enable").catch(() => {});
  const params = frameId ? ({ frameId } as Record<string, unknown>) : {};
  const { nodes } = await session.send<{
    nodes: Protocol.Accessibility.AXNode[];
  }>("Accessibility.getFullAXTree", params);

  // Build URL map directly from AX properties. Each node with a backend id and a 'url' contributes.
  const urlMap: Record<string, string> = {};
  for (const n of nodes) {
    const be = n.backendDOMNodeId;
    if (typeof be !== "number") continue;
    const url = extractUrlFromAXNode(n);
    if (!url) continue;
    const enc = opts.encode(be);
    urlMap[enc] = url; // last write wins is fine
  }

  const decorated = decorateRoles(nodes, opts);
  const { tree } = await buildHierarchicalTree(decorated, opts);

  const simplified = tree.map((n) => formatTreeLine(n)).join("\n");
  return { outline: simplified.trimEnd(), urlMap };
}

/**
 * Decorate AX nodes and project to our A11yNode shape.
 * - Stamps **encodedId** using the provided `opts.encode(backendNodeId)` so the outline
 *   and maps use `[ordinal-backendId]` instead of opaque AX node ids.
 * - Placeholder for scrollable detection (kept false for now).
 */
function decorateRoles(
  nodes: Protocol.Accessibility.AXNode[],
  opts: A11yOptions,
): A11yNode[] {
  const asRole = (n: Protocol.Accessibility.AXNode) =>
    String(n.role?.value ?? "");

  // Placeholder: wire proper scrollable detection later
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isScrollable = (_n: Protocol.Accessibility.AXNode) =>
    opts.detectScrollable ? false : false;

  return nodes.map((n) => {
    let role = asRole(n);
    if (isScrollable(n)) {
      role =
        role && role !== "generic" && role !== "none"
          ? `scrollable, ${role}`
          : "scrollable";
    }

    let encodedId: string | undefined;
    if (typeof n.backendDOMNodeId === "number") {
      try {
        encodedId = opts.encode(n.backendDOMNodeId);
      } catch {
        // ignore encode failures; fall back to nodeId in outline
      }
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

/**
 * Build a hierarchical A11y tree and prune structural wrappers.
 * (We do not build URL map here; URL extraction is done directly in `a11yForFrame`.)
 */
async function buildHierarchicalTree(
  nodes: A11yNode[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: A11yOptions,
): Promise<{ tree: A11yNode[] }> {
  const nodeMap = new Map<string, A11yNode>();

  // Pass 1: keep nodes that are named / have children / are non-structural
  for (const n of nodes) {
    const keep =
      !!(n.name && n.name.trim()) ||
      !!(n.childIds && n.childIds.length) ||
      !isStructural(n.role);
    if (!keep) continue;
    nodeMap.set(n.nodeId, { ...n });
  }

  // Pass 2: parent-child wiring
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

  // Pass 3: prune/collapse structural wrappers
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

    if (isStructural(node.role)) {
      if (cleanedKids.length === 1) return cleanedKids[0]!;
      if (cleanedKids.length === 0) return null;
    }

    return { ...node, children: cleanedKids };
  }
}

/**
 * Outline formatter:
 * - Prefer **encodedId** (`[ordinal-backendId]`) when present
 * - Fallback to AX `nodeId` if no backend id was available
 */
function formatTreeLine(node: A11yNode, level = 0): string {
  const indent = "  ".repeat(level);
  const labelId = node.encodedId ?? node.nodeId;
  const label = `[${labelId}] ${node.role}${node.name ? `: ${cleanText(node.name)}` : ""}`;
  const kids =
    node.children?.map((c) => formatTreeLine(c, level + 1)).join("\n") ?? "";
  return kids ? `${indent}${label}\n${kids}` : `${indent}${label}`;
}

/* ------------------------------------------------------------------------------------------------
 * Small utilities
 * ----------------------------------------------------------------------------------------------*/

function isStructural(role: string): boolean {
  const r = role?.toLowerCase();
  return r === "generic" || r === "none" || r === "inlinetextbox";
}

/** Clean text: remove private-use unicode + normalize NBSP-like spaces. */
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

/** Extract URL (if any) from an AX node's properties. */
function extractUrlFromAXNode(
  ax: Protocol.Accessibility.AXNode,
): string | undefined {
  const props = ax.properties ?? [];
  const urlProp = props.find((p) => p.name === "url");
  const value = urlProp?.value?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Locate a node by backendNodeId inside a DOM.getDocument tree (used for scoping same-proc iframes). */
function findNodeByBackendId(
  root: Protocol.DOM.Node,
  backendNodeId: number,
): Protocol.DOM.Node | undefined {
  const stack: Protocol.DOM.Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.backendNodeId === backendNodeId) return n;

    // traverse children
    if (n.children) for (const c of n.children) stack.push(c);
    // traverse shadow roots
    if (n.shadowRoots) for (const s of n.shadowRoots) stack.push(s);
    // traverse contentDocument (iframe)
    if (n.contentDocument) stack.push(n.contentDocument);
  }
  return undefined;
}
