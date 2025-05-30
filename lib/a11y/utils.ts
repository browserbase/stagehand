import {
  AccessibilityNode,
  TreeResult,
  AXNode,
  DOMNode,
  BackendIdMaps,
  CdpFrameTree,
  FrameOwnerResult,
  FrameSnapshot,
  CombinedA11yResult,
  EncodedId,
  getFrameOrdinal,
  encodeId,
  RichNode,
} from "../../types/context";
import { StagehandPage } from "../StagehandPage";
import { LogLine } from "../../types/log";
import { Page, Locator } from "playwright";
import {
  PlaywrightCommandMethodNotSupportedException,
  PlaywrightCommandException,
} from "@/types/playwright";
import {
  StagehandDomProcessError,
  StagehandElementNotFoundError,
} from "@/types/stagehandErrors";
import { CDPSession, Frame } from "@playwright/test";

const PUA_START = 0xe000;
const PUA_END = 0xf8ff;

const NBSP_CHARS = new Set<number>([0x00a0, 0x202f, 0x2007, 0xfeff]);

/**
 * Clean a string by removing private-use unicode characters, normalizing whitespace,
 * and trimming the result.
 *
 * @param input - The text to clean, potentially containing PUA and NBSP characters.
 * @returns A cleaned string with PUA characters removed, NBSP variants collapsed,
 *          consecutive spaces merged, and leading/trailing whitespace trimmed.
 */
export function cleanText(input: string): string {
  let out = "";
  let prevWasSpace = false;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    // Skip private-use area glyphs
    if (code >= PUA_START && code <= PUA_END) {
      continue;
    }

    // Convert NBSP-family characters to a single space, collapsing repeats
    if (NBSP_CHARS.has(code)) {
      if (!prevWasSpace) {
        out += " ";
        prevWasSpace = true;
      }
      continue;
    }

    // Append the character and update space tracker
    out += input[i];
    prevWasSpace = input[i] === " ";
  }

  // Trim leading/trailing spaces before returning
  return out.trim();
}

// Parser function for str output

/**
 * Generate a human-readable, indented outline of an accessibility node tree.
 *
 * @param node - The accessibility node to format, optionally with an encodedId.
 * @param level - The current depth level for indentation (used internally).
 * @returns A string representation of the node and its descendants, with one node per line.
 */
export function formatSimplifiedTree(
  node: AccessibilityNode & { encodedId?: EncodedId },
  level = 0,
): string {
  // Compute indentation based on depth level
  const indent = "  ".repeat(level);

  // Use encodedId if available, otherwise fallback to nodeId
  const idLabel = node.encodedId ?? node.nodeId;

  // Prepare the formatted name segment if present
  const namePart = node.name ? `: ${cleanText(node.name)}` : "";

  // Build current line and recurse into child nodes
  const currentLine = `${indent}[${idLabel}] ${node.role}${namePart}\n`;
  const childrenLines =
    node.children
      ?.map((c) => formatSimplifiedTree(c as typeof node, level + 1))
      .join("") ?? "";

  return currentLine + childrenLines;
}

const lowerCache = new Map<string, string>();

/**
 * Memoized lowercase conversion for strings to avoid repeated .toLowerCase() calls.
 *
 * @param raw - The original string to convert.
 * @returns The lowercase version of the input string, cached for future reuse.
 */
const lc = (raw: string): string => {
  let v = lowerCache.get(raw);
  if (!v) {
    v = raw.toLowerCase();
    lowerCache.set(raw, v);
  }
  return v;
};

/**
 * Returns a `BackendIdMaps` object, which contains two mappings:
 * 1. a `tagNameMap`, which is a mapping of `backendNodeId`s -> `nodeName`s
 * 2. an `xpathMap`, which is a mapping of `backendNodeId`s -> `xPaths`s
 */
const fidToOrdinal = new Map<string | undefined, number>();

/**
 * Return an integer ≤ 99 that is stable for the lifetime of the page.
 *  - 0 for the main frame (fid === undefined)
 *  - 1+ for each distinct CDP frameId encountered, in discovery order
 *
 * @param fid - The CDP frame identifier, or undefined for the main document.
 * @returns A stable integer [0..99] representing the frame ordinal.
 */
export function ordinalForFrameId(fid: string | undefined): number {
  // main frame: always 0 (same as getFrameOrdinal(undefined))
  if (fid === undefined) return 0;

  // fast path – already assigned
  const cached = fidToOrdinal.get(fid);
  if (cached !== undefined) return cached;

  // assign a new one
  const next = fidToOrdinal.size + 1; // 1, 2, 3, …
  if (next > 99) throw new Error("More than 99 frames – enlarge encoding");

  fidToOrdinal.set(fid, next);
  return next;
}

/**
 * Encode a combination of frame ordinal and backend DOM node ID into a stable EncodedId.
 *
 * @param fid - The CDP frame identifier, or undefined for the main document.
 * @param backendId - The backendNodeId of the DOM node to encode.
 * @returns A string in the format "{frameOrdinal}-{backendId}" as EncodedId.
 */
const encodeWithFrameId = (
  fid: string | undefined,
  backendId: number,
): EncodedId => `${ordinalForFrameId(fid)}-${backendId}` as EncodedId;

/**
 * Build mappings from CDP backendNodeIds to HTML tag names and relative XPaths.
 *
 * @param sp - The StagehandPage wrapper for Playwright and CDP calls.
 * @param targetFrame - Optional Playwright.Frame whose DOM subtree to map; defaults to main frame.
 * @returns A Promise resolving to BackendIdMaps containing tagNameMap and xpathMap.
 */
export async function buildBackendIdMaps(
  sp: StagehandPage,
  targetFrame?: Frame,
): Promise<BackendIdMaps> {
  /* 0 ─ choose CDP session ---------------------------------------- */
  let session: CDPSession;
  if (!targetFrame || targetFrame === sp.page.mainFrame()) {
    session = await sp.getCDPClient();
  } else {
    try {
      session = await sp.context.newCDPSession(targetFrame); // OOPIF
    } catch {
      session = await sp.getCDPClient(); // same-proc iframe
    }
  }

  await sp.enableCDP(
    "DOM",
    session === (await sp.getCDPClient()) ? undefined : targetFrame,
  );

  try {
    /* 1 ─ full DOM tree ------------------------------------------- */
    const { root } = (await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    })) as { root: DOMNode };

    /* 2 ─ pick start node + root frame-id ------------------------- */
    let startNode: DOMNode = root;
    let rootFid: string | undefined =
      targetFrame && (await getCDPFrameId(sp, targetFrame));

    if (
      targetFrame &&
      targetFrame !== sp.page.mainFrame() && // ← added guard
      session === (await sp.getCDPClient())
    ) {
      /* same-proc iframe: walk down to its contentDocument          */
      const frameId = rootFid!;
      const { backendNodeId } = await sp.sendCDP<{ backendNodeId: number }>(
        "DOM.getFrameOwner",
        { frameId },
      );

      let iframeNode: DOMNode | undefined;
      const locate = (n: DOMNode): boolean =>
        n.backendNodeId === backendNodeId
          ? ((iframeNode = n), true)
          : !!n.children?.some(locate);

      if (!locate(root) || !iframeNode?.contentDocument) {
        throw new Error("iframe element or its contentDocument not found");
      }
      startNode = iframeNode.contentDocument;
      rootFid = iframeNode.contentDocument.frameId ?? frameId;
    }

    /* 3 ─ DFS walk: fill maps ------------------------------------- */
    const tagNameMap: Record<EncodedId, string> = {};
    const xpathMap: Record<EncodedId, string> = {};

    interface StackEntry {
      node: DOMNode;
      path: string;
      fid: string | undefined; // DevTools frame-id of this node’s doc
    }
    const stack: StackEntry[] = [{ node: startNode, path: "", fid: rootFid }];
    const seen = new Set<EncodedId>();

    while (stack.length) {
      const { node, path, fid } = stack.pop()!;

      if (!node.backendNodeId) continue;
      const enc = encodeWithFrameId(fid, node.backendNodeId);
      if (seen.has(enc)) continue;
      seen.add(enc);

      tagNameMap[enc] = lc(String(node.nodeName));
      xpathMap[enc] = path;

      /* recurse into sub-document if <iframe> --------------------- */
      if (lc(node.nodeName) === "iframe" && node.contentDocument) {
        const childFid = node.contentDocument.frameId ?? fid;
        stack.push({ node: node.contentDocument, path: "", fid: childFid });
      }

      /* push children --------------------------------------------- */
      const kids = node.children ?? [];
      if (kids.length) {
        /* build per-child XPath segment (L→R) */
        const segs: string[] = [];
        const ctr: Record<string, number> = {};
        for (const child of kids) {
          const tag = lc(String(child.nodeName));
          const key = `${child.nodeType}:${tag}`;
          const idx = (ctr[key] = (ctr[key] ?? 0) + 1);
          segs.push(
            child.nodeType === 3
              ? `text()[${idx}]`
              : child.nodeType === 8
                ? `comment()[${idx}]`
                : `${tag}[${idx}]`,
          );
        }
        /* push R→L so traversal remains L→R */
        for (let i = kids.length - 1; i >= 0; i--) {
          stack.push({
            node: kids[i]!,
            path: `${path}/${segs[i]}`,
            fid,
          });
        }
      }
    }

    return { tagNameMap, xpathMap };
  } finally {
    await sp.disableCDP(
      "DOM",
      session === (await sp.getCDPClient()) ? undefined : targetFrame,
    );
  }
}

/**
 * Recursively prune or collapse structural nodes in the AX tree to simplify hierarchy.
 *
 * @param node - The accessibility node to clean, potentially collapsing or dropping generic/none roles.
 * @param tagNameMap - Mapping from EncodedId to HTML tag names for potential role reassignment.
 * @param logger - Optional logging callback for diagnostic messages.
 * @returns A Promise resolving to a cleaned AccessibilityNode or null if the node should be removed.
 */
async function cleanStructuralNodes(
  node: AccessibilityNode & { encodedId?: EncodedId },
  tagNameMap: Record<EncodedId, string>,
  logger?: (l: LogLine) => void,
): Promise<AccessibilityNode | null> {
  /* 0 ─ ignore negative pseudo-nodes -------------------------------- */
  if (+node.nodeId < 0) return null;

  /* 1 ─ leaf check -------------------------------------------------- */
  if (!node.children?.length) {
    return node.role === "generic" || node.role === "none" ? null : node;
  }

  /* 2 ─ recurse into children -------------------------------------- */
  const cleanedChildren = (
    await Promise.all(
      node.children.map((c) => cleanStructuralNodes(c, tagNameMap, logger)),
    )
  ).filter(Boolean) as AccessibilityNode[];

  /* 3 ─ collapse / prune generic wrappers -------------------------- */
  if (node.role === "generic" || node.role === "none") {
    if (cleanedChildren.length === 1) {
      // Collapse single-child structural node
      return cleanedChildren[0];
    } else if (cleanedChildren.length === 0) {
      // Remove empty structural node
      return null;
    }
    if (cleanedChildren.length === 0) return null;
  }

  /* 4 ─ replace generic role with real tag name (if we know it) ---- */
  if (
    (node.role === "generic" || node.role === "none") &&
    node.encodedId !== undefined
  ) {
    const tagName = tagNameMap[node.encodedId];
    if (tagName) node.role = tagName;
  }

  /* 5 ─ drop redundant StaticText children ------------------------- */
  const pruned = removeRedundantStaticTextChildren(node, cleanedChildren);
  if (!pruned.length && (node.role === "generic" || node.role === "none")) {
    return null;
  }

  /* 6 ─ return updated node --------------------------------------- */
  return { ...node, children: pruned };
}

/**
 * Convert a flat array of AccessibilityNodes into a cleaned, hierarchical tree.
 * Nodes are pruned, structural wrappers removed, and each kept node is stamped
 * with its EncodedId for later lookup or subtree injection.
 *
 * @param nodes - Raw flat list of AX nodes retrieved via CDP.
 * @param tagNameMap - Mapping of EncodedId to HTML tag names for structural decisions.
 * @param logger - Optional function for logging diagnostic messages.
 * @param xpathMap - Optional mapping of EncodedId to relative XPath for element lookup.
 * @returns A Promise resolving to a TreeResult with cleaned tree, simplified text outline,
 *          iframe list, URL map, and inherited xpathMap.
 */
export async function buildHierarchicalTree(
  nodes: AccessibilityNode[],
  tagNameMap: Record<EncodedId, string>,
  logger?: (l: LogLine) => void,
  xpathMap?: Record<EncodedId, string>,
): Promise<TreeResult> {
  /** EncodedId → URL (only if the backend-id is unique) */
  const idToUrl: Record<EncodedId, string> = {};

  /** nodeId (string) → mutable copy of the AX node we keep */
  const nodeMap = new Map<string, RichNode>();

  /** list of iframe AX nodes (kept for backwards-compat analytics) */
  const iframeList: AccessibilityNode[] = [];

  /* helper: keep only roles that matter to the LLM ------------------ */
  const isInteractive = (n: AccessibilityNode) =>
    n.role !== "none" && n.role !== "generic" && n.role !== "InlineTextBox";

  /* -----------------------------------------------------------------
   *  Build “backendId → EncodedId[]” lookup from tagNameMap keys
   * ----------------------------------------------------------------- */
  const backendToIds = new Map<number, EncodedId[]>();
  for (const enc of Object.keys(tagNameMap) as EncodedId[]) {
    const [, backend] = enc.split("-"); // "ff-bb"
    const list = backendToIds.get(+backend) ?? [];
    list.push(enc);
    backendToIds.set(+backend, list);
  }

  /* -----------------------------------------------------------------
   *  Pass 1 – copy / filter CDP nodes we want to keep
   * ----------------------------------------------------------------- */
  for (const node of nodes) {
    if (+node.nodeId < 0) continue; // skip pseudo-nodes

    const url = extractUrlFromAXNode(node);

    const keep =
      node.name?.trim() || node.childIds?.length || isInteractive(node);
    if (!keep) continue;

    /* resolve our EncodedId (unique per backendId) ----------------- */
    let encodedId: EncodedId | undefined;
    if (node.backendDOMNodeId !== undefined) {
      const matches = backendToIds.get(node.backendDOMNodeId) ?? [];
      if (matches.length === 1) encodedId = matches[0]; // unique → keep
      // if there are collisions we leave encodedId undefined; subtree
      // injection will fall back to backend-id matching
    }

    /* store URL only when we have an unambiguous EncodedId */
    if (url && encodedId) idToUrl[encodedId] = url;

    nodeMap.set(node.nodeId, {
      encodedId,
      role: node.role,
      nodeId: node.nodeId,
      ...(node.name && { name: node.name }),
      ...(node.description && { description: node.description }),
      ...(node.value && { value: node.value }),
      ...(node.backendDOMNodeId !== undefined && {
        backendDOMNodeId: node.backendDOMNodeId,
      }),
    });
  }

  /* -----------------------------------------------------------------
   *  Pass 2 – parent-child wiring
   * ----------------------------------------------------------------- */
  for (const node of nodes) {
    if (node.role === "Iframe")
      iframeList.push({ role: node.role, nodeId: node.nodeId });

    if (!node.parentId) continue;
    const parent = nodeMap.get(node.parentId);
    const current = nodeMap.get(node.nodeId);
    if (parent && current) (parent.children ??= []).push(current);
  }

  /* -----------------------------------------------------------------
   *  Pass 3 – prune structural wrappers & tidy tree
   * ----------------------------------------------------------------- */
  const roots = nodes
    .filter((n) => !n.parentId && nodeMap.has(n.nodeId))
    .map((n) => nodeMap.get(n.nodeId)!) as RichNode[];

  const cleanedRoots = (
    await Promise.all(
      roots.map((n) => cleanStructuralNodes(n, tagNameMap, logger)),
    )
  ).filter(Boolean) as AccessibilityNode[];

  /* pretty outline for logging / LLM input -------------------------- */
  const simplified = cleanedRoots.map(formatSimplifiedTree).join("\n");

  return {
    tree: cleanedRoots,
    simplified,
    iframes: iframeList,
    idToUrl, // EncodedId → absolute URL
    xpathMap,
  };
}

/**
 * Resolve the CDP frame identifier for a Playwright Frame, handling same-process and OOPIF.
 *
 * @param sp - The StagehandPage instance for issuing CDP commands.
 * @param frame - The target Playwright.Frame; undefined or main frame yields undefined.
 * @returns A Promise resolving to the CDP frameId string, or undefined for main document.
 */
export async function getCDPFrameId(
  sp: StagehandPage,
  frame?: Frame,
): Promise<string | undefined> {
  if (!frame || frame === sp.page.mainFrame()) return undefined;

  /* 1️⃣  Same-proc search in the page-session tree ------------------ */
  const rootResp = (await sp.sendCDP("Page.getFrameTree")) as unknown;
  const { frameTree: root } = rootResp as { frameTree: CdpFrameTree };

  const url = frame.url();
  let depth = 0;
  for (let p = frame.parentFrame(); p; p = p.parentFrame()) depth++;

  const findByUrlDepth = (node: CdpFrameTree, lvl = 0): string | undefined => {
    if (lvl === depth && node.frame.url === url) return node.frame.id;
    for (const child of node.childFrames ?? []) {
      const id = findByUrlDepth(child, lvl + 1);
      if (id) return id;
    }
    return undefined;
  };

  const sameProcId = findByUrlDepth(root);
  if (sameProcId) return sameProcId; // ✅ found in page tree

  /* 2️⃣  OOPIF path: open its own target ----------------------------- */
  try {
    const sess = await sp.context.newCDPSession(frame); // throws if detached

    const ownResp = (await sess.send("Page.getFrameTree")) as unknown;
    const { frameTree } = ownResp as { frameTree: CdpFrameTree };

    return frameTree.frame.id; // root of OOPIF
  } catch (err) {
    throw new Error(
      `Unable to resolve frameId for iframe (${url}): ${String(err)}`,
    );
  }
}

/**
 * Retrieve and build a cleaned accessibility tree for a document or specific iframe.
 * Prunes, formats, and optionally filters by XPath, including scrollable role decoration.
 *
 * @param stagehandPage - The StagehandPage instance for Playwright and CDP interaction.
 * @param logger - Logging function for diagnostics and performance metrics.
 * @param selector - Optional XPath to filter the AX tree to a specific subtree.
 * @param targetFrame - Optional Playwright.Frame to scope the AX tree retrieval.
 * @returns A Promise resolving to a TreeResult with the hierarchical AX tree and related metadata.
 */
export async function getAccessibilityTree(
  stagehandPage: StagehandPage,
  logger: (log: LogLine) => void,
  selector?: string,
  targetFrame?: Frame,
): Promise<TreeResult> {
  /* ── 0. DOM helpers (maps, xpath) ────────────────────────────────── */
  const { tagNameMap, xpathMap } = await buildBackendIdMaps(
    stagehandPage,
    targetFrame,
  );

  /* always enable on the *target* session we’ll talk to later          */
  await stagehandPage.enableCDP("Accessibility", targetFrame);

  try {
    /* ── 1. Decide params + session for the CDP call ───────────────── */
    let params: Record<string, unknown> = {};
    let sessionFrame: Frame | undefined = targetFrame; // default: talk to that frame

    if (targetFrame && targetFrame !== stagehandPage.page.mainFrame()) {
      /* try opening a CDP session: succeeds only for OOPIFs            */
      let isOopif = true;
      try {
        await stagehandPage.context.newCDPSession(targetFrame);
      } catch {
        isOopif = false;
      }

      if (!isOopif) {
        // same-proc → use *page* session + { frameId }
        const frameId = await getCDPFrameId(stagehandPage, targetFrame);
        logger({ message: `same-proc iframe, frameId=${frameId}`, level: 1 });
        if (frameId) params = { frameId };
        sessionFrame = undefined; // page session
      } else {
        logger({ message: `OOPIF iframe – own session`, level: 1 });
        params = {}; // no frameId allowed
        sessionFrame = targetFrame; // talk to OOPIF session
      }
    }

    /* ── 2. Fetch raw AX nodes ─────────────────────────────────────── */
    const { nodes: fullNodes } = await stagehandPage.sendCDP<{
      nodes: AXNode[];
    }>("Accessibility.getFullAXTree", params, sessionFrame);

    /* ── 3. Scrollable detection (frame-aware) ─────────────────────── */
    const scrollableIds = await findScrollableElementIds(
      stagehandPage,
      targetFrame,
    );

    /* ── 4. Optional selector filter ───────────────────────────────── */
    let nodes = fullNodes;
    if (selector) {
      nodes = await filterAXTreeByXPath(
        stagehandPage,
        fullNodes,
        selector,
        targetFrame,
      );
    }

    /* ── 5. Build hierarchical tree ────────────────────────────────── */
    const start = Date.now();
    const tree = await buildHierarchicalTree(
      decorateRoles(nodes, scrollableIds),
      tagNameMap,
      logger,
      xpathMap,
    );

    logger({
      category: "observation",
      message: `got accessibility tree in ${Date.now() - start} ms`,
      level: 1,
    });
    return tree;
  } finally {
    await stagehandPage.disableCDP("Accessibility", targetFrame);
  }
}

/**
 * Filter an accessibility tree to include only the subtree under a specific XPath root.
 * Resolves the DOM node for the XPath and performs a BFS over the AX node graph.
 *
 * @param page - The StagehandPage instance for issuing CDP commands.
 * @param full - The full list of AXNode entries to filter.
 * @param xpath - The XPath expression locating the subtree root.
 * @param targetFrame - Optional Playwright.Frame context for CDP evaluation.
 * @returns A Promise resolving to an array of AXNode representing the filtered subtree.
 */
async function filterAXTreeByXPath(
  page: StagehandPage,
  full: AXNode[],
  xpath: string,
  targetFrame?: Frame,
): Promise<AXNode[]> {
  // Resolve the backendNodeId for the element at the provided XPath
  const objectId = await resolveObjectIdForXPath(page, xpath, targetFrame);
  // Describe the DOM node to retrieve its backendNodeId via CDP
  const { node } = await page.sendCDP<{ node: { backendNodeId: number } }>(
    "DOM.describeNode",
    { objectId },
    targetFrame,
  );

  // Throw if unable to get a backendNodeId for the XPath target
  if (!node?.backendNodeId) {
    throw new StagehandDomProcessError(
      `Unable to resolve backendNodeId for "${xpath}"`,
    );
  }
  // Locate the corresponding AXNode in the full tree
  const target = full.find((n) => n.backendDOMNodeId === node.backendNodeId)!;

  // Initialize BFS: collect the target node and its descendants
  const keep = new Set<string>([target.nodeId]);
  const queue = [target];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const id of cur.childIds ?? []) {
      if (keep.has(id)) continue;
      keep.add(id);
      const child = full.find((n) => n.nodeId === id);
      if (child) queue.push(child);
    }
  }
  // Return only nodes in the keep set, unsetting parentId for the new root
  return full
    .filter((n) => keep.has(n.nodeId))
    .map((n) =>
      n.nodeId === target.nodeId ? { ...n, parentId: undefined } : n,
    );
}

/**
 * Decorate AX nodes by marking scrollable elements in their role property.
 *
 * @param nodes - Array of raw AXNode entries to decorate with scrollability.
 * @param scrollables - Set of backendNodeId values representing scrollable elements.
 * @returns A new array of AccessibilityNode objects with updated roles indicating scrollable elements.
 */
function decorateRoles(
  nodes: AXNode[],
  scrollables: Set<number>,
): AccessibilityNode[] {
  return nodes.map((n) => {
    // Extract the base role from the AX node
    let role = n.role?.value ?? "";

    // Prepend "scrollable" to roles of nodes identified as scrollable
    if (scrollables.has(n.backendDOMNodeId!)) {
      role =
        role && role !== "generic" && role !== "none"
          ? `scrollable, ${role}`
          : "scrollable";
    }

    // Construct the AccessibilityNode with decorated role and existing properties
    return {
      role,
      name: n.name?.value,
      description: n.description?.value,
      value: n.value?.value,
      nodeId: n.nodeId,
      backendDOMNodeId: n.backendDOMNodeId,
      parentId: n.parentId,
      childIds: n.childIds,
      properties: n.properties,
    };
  });
}

/**
 * Get the backendNodeId of the iframe element that contains a given Playwright.Frame.
 *
 * @param sp - The StagehandPage instance for issuing CDP commands.
 * @param frame - The Playwright.Frame whose host iframe element to locate.
 * @returns A Promise resolving to the backendNodeId of the iframe element, or null if not applicable.
 */
export async function getFrameRootBackendNodeId(
  sp: StagehandPage,
  frame: Frame | undefined,
): Promise<number | null> {
  // Return null for top-level or undefined frames
  if (!frame || frame === sp.page.mainFrame()) {
    return null;
  }

  // Create a CDP session on the main page context
  const cdp = await sp.page.context().newCDPSession(sp.page);
  // Resolve the CDP frameId for the target iframe frame
  const fid = await getCDPFrameId(sp, frame);
  if (!fid) {
    return null;
  }

  // Retrieve the DOM node that owns the frame via CDP
  const { backendNodeId } = (await cdp.send("DOM.getFrameOwner", {
    frameId: fid,
  })) as FrameOwnerResult;

  return backendNodeId ?? null;
}

/**
 * Compute the absolute XPath for the iframe element hosting a given Playwright.Frame.
 *
 * @param frame - The Playwright.Frame whose iframe element to locate.
 * @returns A Promise resolving to the XPath of the iframe element, or "/" if no frame provided.
 */
export async function getFrameRootXpath(
  frame: Frame | undefined,
): Promise<string> {
  // Return root path when no frame context is provided
  if (!frame) {
    return "/";
  }
  // Obtain the element handle of the iframe in the embedding document
  const handle = await frame.frameElement();
  // Evaluate the element's absolute XPath within the page context
  return handle.evaluate((node: Element) => {
    const pos = (el: Element) => {
      let i = 1;
      for (
        let sib = el.previousElementSibling;
        sib;
        sib = sib.previousElementSibling
      )
        if (sib.tagName === el.tagName) i += 1;
      return i;
    };
    const segs: string[] = [];
    for (let el: Element | null = node; el; el = el.parentElement)
      segs.unshift(`${el.tagName.toLowerCase()}[${pos(el)}]`);
    return `/${segs.join("/")}`;
  });
}

/**
 * Inject simplified subtree outlines into the main frame outline for nested iframes.
 * Walks the main tree text, looks for EncodedId labels, and inserts matching subtrees.
 *
 * @param tree - The indented AX outline of the main frame.
 * @param idToTree - Map of EncodedId to subtree outlines for nested frames.
 * @returns A single combined text outline with iframe subtrees injected.
 */
export function injectSubtrees(
  tree: string,
  idToTree: Map<EncodedId, string>,
): string {
  /* ---------------------------------------------------------------
   *  Helpers
   * ------------------------------------------------------------- */

  /**  Return the *only* EncodedId that ends with this backend-id.
   *   If several frames share that backend-id we return undefined
   *   (avoids guessing the wrong subtree). */
  const uniqueByBackend = (backendId: number): EncodedId | undefined => {
    let found: EncodedId | undefined;
    let hit = 0;
    for (const enc of idToTree.keys()) {
      const [, b] = enc.split("-"); // "ff-bbb"
      if (+b === backendId) {
        if (++hit > 1) return; // collision → abort
        found = enc;
      }
    }
    return hit === 1 ? found : undefined;
  };

  interface StackFrame {
    lines: string[];
    idx: number;
    indent: string;
  }

  const stack: StackFrame[] = [{ lines: tree.split("\n"), idx: 0, indent: "" }];
  const out: string[] = [];
  const visited = new Set<EncodedId>(); // avoid infinite loops

  /* ---------------------------------------------------------------
   *  Depth-first injection walk
   * ------------------------------------------------------------- */
  while (stack.length) {
    const top = stack[stack.length - 1];

    if (top.idx >= top.lines.length) {
      stack.pop();
      continue;
    }

    const raw = top.lines[top.idx++];
    const line = top.indent + raw;
    out.push(line);

    /* grab whatever sits inside the first brackets, e.g. “[0:42]” or “[42]” */
    const m = /^\s*\[([^\]]+)]/.exec(raw);
    if (!m) continue;

    const label = m[1]; // could be "1:13"   or "13"
    let enc: EncodedId | undefined;
    let child: string | undefined;

    /* 1️⃣  exact match (“0:42”) ------------------------------------ */
    if (idToTree.has(label as EncodedId)) {
      enc = label as EncodedId;
      child = idToTree.get(enc);
    } else if (/^\d+$/.test(label)) {
      /* 2️⃣  backend-id fallback (“42”) ------------------------------ */
      const backendId = +label;
      const alt = uniqueByBackend(backendId);
      if (alt) {
        enc = alt;
        child = idToTree.get(alt);
      }
    }

    if (!enc || !child || visited.has(enc)) continue;

    visited.add(enc);
    stack.push({
      lines: child.split("\n"),
      idx: 0,
      indent: (line.match(/^\s*/)?.[0] ?? "") + "  ",
    });
  }

  return out.join("\n");
}

/**
 * Retrieve and merge accessibility trees for the main document and nested iframes.
 * Walks through frame chains if a root XPath is provided, then stitches subtree outlines.
 *
 * @param stagehandPage - The StagehandPage instance for Playwright and CDP interaction.
 * @param logger - Logging function for diagnostics and performance.
 * @param rootXPath - Optional absolute XPath to focus the crawl on a subtree across frames.
 * @returns A Promise resolving to CombinedA11yResult with combined tree text, xpath map, and URL map.
 */
export async function getAccessibilityTreeWithFrames(
  stagehandPage: StagehandPage,
  logger: (l: LogLine) => void,
  rootXPath?: string,
): Promise<CombinedA11yResult> {
  /* ── 0. main-frame bookkeeping ─────────────────────────────────── */
  const main = stagehandPage.page.mainFrame();
  getFrameOrdinal(main); // ensure ordinal 0

  /* ── 1. “focus XPath” → frame chain + inner XPath ──────────────── */
  let targetFrames: Frame[] | undefined; // full chain, main-first
  let innerXPath: string | undefined;

  if (rootXPath?.trim()) {
    const { frames, rest } = await resolveFrameChain(
      stagehandPage,
      rootXPath.trim(),
    );
    targetFrames = frames.length ? frames : undefined; // empty → undefined
    innerXPath = rest;
  }

  const mainOnlyFilter = !!innerXPath && !targetFrames;

  /* ── 2. depth-first walk – collect snapshots ───────────────────── */
  const snapshots: FrameSnapshot[] = [];
  const frameStack: Frame[] = [main];

  while (frameStack.length) {
    const frame = frameStack.pop()!;

    /* unconditional: enqueue children so we can reach deep targets */
    frame.childFrames().forEach((c) => frameStack.push(c));

    /* skip frames that are outside the requested chain / slice */
    if (targetFrames && !targetFrames.includes(frame)) continue;
    if (!targetFrames && frame !== main && innerXPath) continue;

    /* selector to forward … (unchanged) */
    const selector = targetFrames
      ? frame === targetFrames.at(-1)
        ? innerXPath
        : undefined
      : frame === main
        ? innerXPath
        : undefined;

    try {
      const res = await getAccessibilityTree(
        stagehandPage,
        logger,
        selector,
        frame,
      );

      /* guard: main frame has no backendNodeId / <iframe> wrapper */
      const backendId =
        frame === main
          ? null
          : await getFrameRootBackendNodeId(stagehandPage, frame);

      const frameXpath = frame === main ? "/" : await getFrameRootXpath(frame);

      snapshots.push({
        tree: res.simplified.trimEnd(),
        xpathMap: res.xpathMap as Record<EncodedId, string>,
        urlMap: res.idToUrl as Record<string, string>,
        frameXpath: frameXpath,
        backendNodeId: backendId,
        parentFrame: frame.parentFrame(),
      });

      if (mainOnlyFilter) break; // nothing else to fetch
    } catch (err) {
      logger({
        category: "observation",
        message: `⚠️ failed to get AX tree for ${frame === main ? "main frame" : `iframe (${frame.url()})`}`,
        level: 1,
        auxiliary: { error: { value: String(err), type: "string" } },
      });
    }
  }

  /* ── 3. merge per-frame maps ───────────────────────────────────── */
  const combinedXpathMap: Record<EncodedId, string> = {};
  const combinedUrlMap: Record<EncodedId, string> = {};

  for (const snap of snapshots) {
    const prefix = snap.frameXpath === "/" ? "" : snap.frameXpath;
    for (const [enc, local] of Object.entries(snap.xpathMap) as [
      EncodedId,
      string,
    ][])
      combinedXpathMap[enc] =
        prefix + (local.startsWith("/") || !prefix ? "" : "/") + local;

    Object.assign(combinedUrlMap, snap.urlMap);
  }

  /* ── 4. EncodedId → subtree map (skip main) ───────────────────── */
  const idToTree = new Map<EncodedId, string>();
  for (const { backendNodeId, parentFrame, tree } of snapshots)
    if (backendNodeId !== null)
      // ignore main frame
      idToTree.set(encodeId(backendNodeId, parentFrame), tree);

  /* ── 5. stitch everything together ─────────────────────────────── */
  const rootSnap = snapshots.find((s) => s.frameXpath === "/");
  const combinedTree = rootSnap
    ? injectSubtrees(rootSnap.tree, idToTree)
    : (snapshots[0]?.tree ?? "");

  return { combinedTree, combinedXpathMap, combinedUrlMap };
}

/**
 * `findScrollableElementIds` is a function that identifies elements in
 * the browser that are deemed "scrollable". At a high level, it does the
 * following:
 * - Calls the browser-side `window.getScrollableElementXpaths()` function,
 *   which returns a list of XPaths for scrollable containers.
 * - Iterates over the returned list of XPaths, locating each element in the DOM
 *   using `stagehandPage.sendCDP(...)`
 *     - During each iteration, we call `Runtime.evaluate` to run `document.evaluate(...)`
 *       with each XPath, obtaining a `RemoteObject` reference if it exists.
 *     - Then, for each valid object reference, we call `DOM.describeNode` to retrieve
 *       the element’s `backendNodeId`.
 * - Collects all resulting `backendNodeId`s in a Set and returns them.
 *
 * @param stagehandPage - A StagehandPage instance with built-in CDP helpers.
 * @returns A Promise that resolves to a Set of unique `backendNodeId`s corresponding
 *          to scrollable elements in the DOM.
 */
export async function findScrollableElementIds(
  stagehandPage: StagehandPage,
  targetFrame?: Frame,
): Promise<Set<number>> {
  // JS runs inside the right browsing context
  const xpaths: string[] = targetFrame
    ? await targetFrame.evaluate(() => window.getScrollableElementXpaths())
    : await stagehandPage.page.evaluate(() =>
        window.getScrollableElementXpaths(),
      );

  const backendIds = new Set<number>();

  for (const xpath of xpaths) {
    if (!xpath) continue;

    const objectId = await resolveObjectIdForXPath(
      stagehandPage,
      xpath,
      targetFrame,
    );

    if (objectId) {
      const { node } = await stagehandPage.sendCDP<{
        node?: { backendNodeId?: number };
      }>("DOM.describeNode", { objectId }, targetFrame);
      if (node?.backendNodeId) backendIds.add(node.backendNodeId);
    }
  }
  return backendIds;
}

/**
 * Resolve an XPath to a Chrome-DevTools-Protocol (CDP) remote-object ID.
 *
 * @param page     A StagehandPage (or Playwright.Page with .sendCDP)
 * @param xpath    An absolute or relative XPath
 * @returns        The remote objectId for the matched node, or null
 */
export async function resolveObjectIdForXPath(
  page: StagehandPage,
  xpath: string,
  targetFrame?: Frame,
): Promise<string | null> {
  const { result } = await page.sendCDP<{
    result?: { objectId?: string };
  }>(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          const res = document.evaluate(
            ${JSON.stringify(xpath)},
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          return res.singleNodeValue;
        })();
      `,
      returnByValue: false,
    },
    targetFrame,
  );
  if (!result?.objectId) throw new StagehandElementNotFoundError([xpath]);
  return result.objectId;
}

/**
 * Collapse consecutive whitespace characters (spaces, tabs, newlines, carriage returns)
 * into single ASCII spaces.
 *
 * @param s - The string in which to normalize whitespace.
 * @returns A string where runs of whitespace have been replaced by single spaces.
 */
function normaliseSpaces(s: string): string {
  // Initialize output buffer and state flag for whitespace grouping
  let out = "";
  let inWs = false;

  // Iterate through each character of the input string
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    const isWs = ch === 32 || ch === 9 || ch === 10 || ch === 13;

    if (isWs) {
      // If this is the first whitespace in a sequence, append a single space
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      // Non-whitespace character: append it and reset whitespace flag
      out += s[i];
      inWs = false;
    }
  }

  return out;
}

/**
 * Remove StaticText children whose combined text matches the parent's accessible name.
 *
 * @param parent - The parent AccessibilityNode whose `.name` is used for comparison.
 * @param children - The list of child nodes to filter.
 * @returns A new array of children with redundant StaticText nodes removed when they duplicate the parent's name.
 */
function removeRedundantStaticTextChildren(
  parent: AccessibilityNode,
  children: AccessibilityNode[],
): AccessibilityNode[] {
  // If the parent has no accessible name, there is nothing to compare
  if (!parent.name) return children;

  // Normalize and trim the parent's name for accurate string comparison
  const parentNorm = normaliseSpaces(parent.name).trim();
  let combinedText = "";

  // Concatenate all StaticText children's normalized names
  for (const child of children) {
    if (child.role === "StaticText" && child.name) {
      combinedText += normaliseSpaces(child.name).trim();
    }
  }

  // If combined StaticText equals the parent's name, filter them out
  if (combinedText === parentNorm) {
    return children.filter((c) => c.role !== "StaticText");
  }
  return children;
}

/**
 * Extract the URL string from an AccessibilityNode's properties, if present.
 *
 * @param axNode - The AccessibilityNode to inspect for a 'url' property.
 * @returns The URL string if found and valid; otherwise, undefined.
 */
function extractUrlFromAXNode(axNode: AccessibilityNode): string | undefined {
  // Exit early if there are no properties on this node
  if (!axNode.properties) return undefined;

  // Find a property named 'url'
  const urlProp = axNode.properties.find((prop) => prop.name === "url");
  // Return the trimmed URL string if the property exists and is valid
  if (urlProp && urlProp.value && typeof urlProp.value.value === "string") {
    return urlProp.value.value.trim();
  }
  return undefined;
}

const IFRAME_STEP_RE = /iframe\[\d+]$/i;

/**
 * Resolve a chain of iframe frames from an absolute XPath, returning the frame sequence and inner XPath.
 *
 * This helper walks an XPath expression containing iframe steps (e.g., '/html/body/iframe[2]/...'),
 * descending into each matching iframe element to build a frame chain, and returns the leftover
 * XPath segment to evaluate within the context of the last iframe.
 *
 * @param sp - The StagehandPage instance for evaluating XPath and locating frames.
 * @param absPath - An absolute XPath expression starting with '/', potentially including iframe steps.
 * @returns An object containing:
 *   frames: Array of Frame objects representing each iframe in the chain.
 *   rest: The remaining XPath string to evaluate inside the final iframe.
 * @throws Error if an iframe cannot be found or the final XPath cannot be resolved.
 */
export async function resolveFrameChain(
  sp: StagehandPage,
  absPath: string, // must start with '/'
): Promise<{ frames: Frame[]; rest: string }> {
  let path = absPath.startsWith("/") ? absPath : "/" + absPath;
  let ctxFrame: Frame | undefined = undefined; // current frame
  const chain: Frame[] = []; // collected frames

  while (true) {
    /*  Does the whole path already resolve inside the current frame?  */
    try {
      await resolveObjectIdForXPath(sp, path, ctxFrame);
      return { frames: chain, rest: path }; // we’re done
    } catch {
      /* keep walking */
    }

    /*  Otherwise: accumulate steps until we include an <iframe> step  */
    const steps = path.split("/").filter(Boolean);
    const buf: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      buf.push(steps[i]);

      if (IFRAME_STEP_RE.test(steps[i])) {
        /* “/…/iframe[k]” found – descend into that frame ------------- */
        const selector = "xpath=/" + buf.join("/");
        const handle = (ctxFrame ?? sp.page.mainFrame()).locator(selector);
        const frame = await handle
          .elementHandle()
          .then((h) => h?.contentFrame());

        if (!frame)
          throw new Error(`Could not obtain contentFrame for ${selector}`);

        chain.push(frame);
        ctxFrame = frame;
        path = "/" + steps.slice(i + 1).join("/"); // remainder
        break;
      }

      /*  Last step processed – but no iframe found  →  dead-end       */
      if (i === steps.length - 1) {
        throw new Error(`XPath “${absPath}” does not resolve in page`);
      }
    }
  }
}

export async function performPlaywrightMethod(
  stagehandPage: Page,
  logger: (logLine: LogLine) => void,
  method: string,
  args: unknown[],
  xpath: string,
) {
  const locator = stagehandPage.locator(`xpath=${xpath}`).first();
  const initialUrl = stagehandPage.url();

  logger({
    category: "action",
    message: "performing playwright method",
    level: 2,
    auxiliary: {
      xpath: {
        value: xpath,
        type: "string",
      },
      method: {
        value: method,
        type: "string",
      },
    },
  });

  if (method === "scrollIntoView") {
    logger({
      category: "action",
      message: "scrolling element into view",
      level: 2,
      auxiliary: {
        xpath: {
          value: xpath,
          type: "string",
        },
      },
    });
    try {
      await locator
        .evaluate((element: HTMLElement) => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        })
        .catch((e: Error) => {
          logger({
            category: "action",
            message: "error scrolling element into view",
            level: 1,
            auxiliary: {
              error: {
                value: e.message,
                type: "string",
              },
              trace: {
                value: e.stack,
                type: "string",
              },
              xpath: {
                value: xpath,
                type: "string",
              },
            },
          });
        });
    } catch (e) {
      logger({
        category: "action",
        message: "error scrolling element into view",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (method === "fill" || method === "type") {
    try {
      await locator.fill("");
      await locator.click();
      const text = args[0]?.toString();
      for (const char of text) {
        await stagehandPage.keyboard.type(char, {
          delay: Math.random() * 50 + 25,
        });
      }
    } catch (e) {
      logger({
        category: "action",
        message: "error filling element",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (method === "press") {
    try {
      const key = args[0]?.toString();
      await stagehandPage.keyboard.press(key);
    } catch (e) {
      logger({
        category: "action",
        message: "error pressing key",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          key: {
            value: args[0]?.toString() ?? "unknown",
            type: "string",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }
  } else if (typeof locator[method as keyof typeof locator] === "function") {
    // Log current URL before action
    logger({
      category: "action",
      message: "page URL before action",
      level: 2,
      auxiliary: {
        url: {
          value: stagehandPage.url(),
          type: "string",
        },
      },
    });

    // Perform the action
    try {
      await (
        locator[method as keyof Locator] as unknown as (
          ...args: string[]
        ) => Promise<void>
      )(...args.map((arg) => arg?.toString() || ""));
    } catch (e) {
      logger({
        category: "action",
        message: "error performing method",
        level: 1,
        auxiliary: {
          error: {
            value: e.message,
            type: "string",
          },
          trace: {
            value: e.stack,
            type: "string",
          },
          xpath: {
            value: xpath,
            type: "string",
          },
          method: {
            value: method,
            type: "string",
          },
          args: {
            value: JSON.stringify(args),
            type: "object",
          },
        },
      });

      throw new PlaywrightCommandException(e.message);
    }

    // Handle navigation if a new page is opened
    if (method === "click") {
      logger({
        category: "action",
        message: "clicking element, checking for page navigation",
        level: 1,
        auxiliary: {
          xpath: {
            value: xpath,
            type: "string",
          },
        },
      });

      const newOpenedTab = await Promise.race([
        new Promise<Page | null>((resolve) => {
          Promise.resolve(stagehandPage.context()).then((context) => {
            context.once("page", (page: Page) => resolve(page));
            setTimeout(() => resolve(null), 1_500);
          });
        }),
      ]);

      logger({
        category: "action",
        message: "clicked element",
        level: 1,
        auxiliary: {
          newOpenedTab: {
            value: newOpenedTab ? "opened a new tab" : "no new tabs opened",
            type: "string",
          },
        },
      });

      if (newOpenedTab) {
        logger({
          category: "action",
          message: "new page detected (new tab) with URL",
          level: 1,
          auxiliary: {
            url: {
              value: newOpenedTab.url(),
              type: "string",
            },
          },
        });
        await newOpenedTab.close();
        await stagehandPage.goto(newOpenedTab.url());
        await stagehandPage.waitForLoadState("domcontentloaded");
      }

      await Promise.race([
        stagehandPage.waitForLoadState("networkidle"),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]).catch((e) => {
        logger({
          category: "action",
          message: "network idle timeout hit",
          level: 1,
          auxiliary: {
            trace: {
              value: e.stack,
              type: "string",
            },
            message: {
              value: e.message,
              type: "string",
            },
          },
        });
      });

      logger({
        category: "action",
        message: "finished waiting for (possible) page navigation",
        level: 1,
      });

      if (stagehandPage.url() !== initialUrl) {
        logger({
          category: "action",
          message: "new page detected with URL",
          level: 1,
          auxiliary: {
            url: {
              value: stagehandPage.url(),
              type: "string",
            },
          },
        });
      }
    }
  } else {
    logger({
      category: "action",
      message: "chosen method is invalid",
      level: 1,
      auxiliary: {
        method: {
          value: method,
          type: "string",
        },
      },
    });

    throw new PlaywrightCommandMethodNotSupportedException(
      `Method ${method} not supported`,
    );
  }
}
