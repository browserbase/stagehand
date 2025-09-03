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
  /** Filter the A11y tree to this XPath (applied in the root frame). */
  focusXPath?: string;
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

  // ============== 1) Build per-frame DOM + A11y maps (no prefixing yet) ==============
  for (const frameId of frames) {
    const owningSess = ownerSession(page, frameId);

    // DOM maps (scoped to this frame’s document in its owning session)
    const { tagNameMap, xpathMap, scrollableMap } = await domMapsForSession(
      owningSess,
      frameId,
      pierce,
      (fid, be) => `${page.getOrdinal(fid)}-${be}`,
    );

    // A11y (must run on the owning session for this frame)
    const { outline, urlMap } = await a11yForFrame(owningSess, frameId, {
      focusXPath: frames[0] === frameId ? options?.focusXPath : undefined,
      tagNameMap,
      experimental: options?.experimental ?? false,
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
  const c = child.replace(/^\//, "");
  return p ? `${p}/${c}` : `/${c}`;
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
        startNode = ownerEl.contentDocument;
      }
    }
  } catch {
    // OOPIF or no owner in this session → keep startNode = root
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
  if (!base || base === "/") return step ? `/${step}` : "/";
  if (base.endsWith("//")) return `${base}${step}`;
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
  focusXPath?: string;
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

  const decorated = decorateRoles(nodes, opts);
  const { tree } = await buildHierarchicalTree(decorated, opts);

  const simplified = tree.map((n) => formatTreeLine(n)).join("\n");
  return { outline: simplified.trimEnd(), urlMap };
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
