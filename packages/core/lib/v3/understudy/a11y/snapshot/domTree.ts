import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { StagehandDomProcessError } from "../../../types/public/sdkErrors.js";
import type { SessionDomIndex } from "../../../types/private/snapshot.js";
import {
  buildChildXPathSegments,
  joinXPath,
  normalizeXPath,
} from "./xpathUtils.js";

// starting from infinite depth (-1), exponentially shrink down to 1
const DOM_DEPTH_ATTEMPTS = [-1, 256, 128, 64, 32, 16, 8, 4, 2, 1];
const DESCRIBE_DEPTH_ATTEMPTS = [-1, 64, 32, 16, 8, 4, 2, 1];

/** Identify CDP failures caused by deep DOM trees blowing the CBOR encoder stack. */
function isCborStackError(message: string): boolean {
  return message.includes("CBOR: stack limit exceeded");
}

/**
 * Determine if CDP truncated a node's children when streaming the DOM tree.
 * childNodeCount stays accurate even when `children` are omitted; we use this to
 * decide whether DOM.describeNode must be re-run for that node.
 */
export function shouldExpandNode(node: Protocol.DOM.Node): boolean {
  const declaredChildren = node.childNodeCount ?? 0;
  const realizedChildren = node.children?.length ?? 0;
  return declaredChildren > realizedChildren;
}

/** Merge an expanded DescribeNode payload back into the original shallow node. */
export function mergeDomNodes(
  target: Protocol.DOM.Node,
  source: Protocol.DOM.Node,
): void {
  target.childNodeCount = source.childNodeCount ?? target.childNodeCount;
  target.children = source.children ?? target.children;
  target.shadowRoots = source.shadowRoots ?? target.shadowRoots;
  target.contentDocument = source.contentDocument ?? target.contentDocument;
}

/** Helper that returns every nested collection we recurse through uniformly. */
export function collectDomTraversalTargets(
  node: Protocol.DOM.Node,
): Protocol.DOM.Node[] {
  const targets: Protocol.DOM.Node[] = [];
  if (node.children) targets.push(...node.children);
  if (node.shadowRoots) targets.push(...node.shadowRoots);
  if (node.contentDocument) targets.push(node.contentDocument);
  return targets;
}

/**
 * Rehydrate a truncated DOM tree by repeatedly calling DOM.describeNode with
 * decreasing depths. Any non-CBOR failure is surfaced as a StagehandDomProcessError.
 */
export async function hydrateDomTree(
  session: CDPSessionLike,
  root: Protocol.DOM.Node,
  pierce: boolean,
): Promise<void> {
  const stack: Protocol.DOM.Node[] = [root];
  const expandedNodeIds = new Set<number>();
  const expandedBackendIds = new Set<number>();

  while (stack.length) {
    const node = stack.pop()!;
    const nodeId =
      typeof node.nodeId === "number" && node.nodeId > 0
        ? node.nodeId
        : undefined;
    const backendId =
      typeof node.backendNodeId === "number" && node.backendNodeId > 0
        ? node.backendNodeId
        : undefined;

    const seenByNode = nodeId ? expandedNodeIds.has(nodeId) : false;
    const seenByBackend =
      !nodeId && backendId ? expandedBackendIds.has(backendId) : false;
    if (seenByNode || seenByBackend) continue;
    if (nodeId) expandedNodeIds.add(nodeId);
    else if (backendId) expandedBackendIds.add(backendId);

    const needsExpansion = shouldExpandNode(node);
    if (needsExpansion && (nodeId || backendId)) {
      const describeParamsBase = nodeId
        ? { nodeId }
        : { backendNodeId: backendId! };
      let expanded = false;
      for (const depth of DESCRIBE_DEPTH_ATTEMPTS) {
        try {
          const described =
            await session.send<Protocol.DOM.DescribeNodeResponse>(
              "DOM.describeNode",
              {
                ...describeParamsBase,
                depth,
                pierce,
              },
            );
          mergeDomNodes(node, described.node);
          if (!nodeId && described.node.nodeId && described.node.nodeId > 0) {
            node.nodeId = described.node.nodeId;
            expandedNodeIds.add(described.node.nodeId);
          }
          expanded = true;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isCborStackError(message)) {
            continue;
          }
          const identifier = nodeId ?? backendId ?? "unknown";
          throw new StagehandDomProcessError(
            `Failed to expand DOM node ${identifier}: ${String(err)}`,
          );
        }
      }
      if (!expanded) {
        const identifier = nodeId ?? backendId ?? "unknown";
        throw new StagehandDomProcessError(
          `Unable to expand DOM node ${identifier} after describeNode depth retries`,
        );
      }
    }

    for (const child of collectDomTraversalTargets(node)) {
      stack.push(child);
    }
  }
}

/**
 * Attempt DOM.getDocument with progressively shallower depths until CBOR stops
 * complaining. When a shallower snapshot is returned we hydrate the missing
 * branches so downstream DOM traversals see the full tree shape.
 */
export async function getDomTreeWithFallback(
  session: CDPSessionLike,
  pierce: boolean,
): Promise<Protocol.DOM.Node> {
  let lastCborMessage = "";

  for (const depth of DOM_DEPTH_ATTEMPTS) {
    try {
      const { root } = await session.send<{ root: Protocol.DOM.Node }>(
        "DOM.getDocument",
        { depth, pierce },
      );

      if (depth !== -1) {
        await hydrateDomTree(session, root, pierce);
      }

      return root;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isCborStackError(message)) {
        lastCborMessage = message;
        continue;
      }
      throw err;
    }
  }

  throw new StagehandDomProcessError(
    lastCborMessage
      ? `CDP DOM.getDocument failed after adaptive depth retries: ${lastCborMessage}`
      : "CDP DOM.getDocument failed after adaptive depth retries.",
  );
}

/**
 * Build tag name and XPath maps for a single frame session.
 * EncodedId is produced by a frame-aware encoder provided by the caller.
 */
export async function domMapsForSession(
  session: CDPSessionLike,
  frameId: string,
  pierce: boolean,
  encode: (fid: string, backendNodeId: number) => string,
  attemptOwnerLookup = true,
): Promise<{
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
}> {
  await session.send("DOM.enable").catch(() => {});
  const root = await getDomTreeWithFallback(session, pierce);

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
      xpathMap[encId] = xpath || "/";
      const isScrollable = node?.isScrollable === true;
      if (isScrollable) scrollableMap[encId] = true;
    }

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

    for (const sr of node.shadowRoots ?? []) {
      stack.push({
        node: sr,
        xpath: joinXPath(xpath, "//"),
      });
    }
  }

  return { tagNameMap, xpathMap, scrollableMap };
}

/**
 * Build an index of absolute XPath/tag metadata for an entire CDP session.
 * Once the index is cached, per-frame slices are derived without extra DOM
 * calls, which keeps snapshot capture linear in the number of frames.
 */
export async function buildSessionDomIndex(
  session: CDPSessionLike,
  pierce: boolean,
): Promise<SessionDomIndex> {
  await session.send("DOM.enable").catch(() => {});
  const root = await getDomTreeWithFallback(session, pierce);

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
      if (node?.isScrollable === true) scrollByBe.set(node.backendNodeId, true);
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

/**
 * Relativize an absolute XPath against a document root's absolute path.
 * When the node lives outside the document we return the absolute path as-is.
 */
export function relativizeXPath(baseAbs: string, nodeAbs: string): string {
  const base = normalizeXPath(baseAbs);
  const abs = normalizeXPath(nodeAbs);
  if (abs === base) return "/";
  if (abs.startsWith(base)) {
    const tail = abs.slice(base.length);
    if (!tail) return "/";
    return tail.startsWith("/") || tail.startsWith("//") ? tail : `/${tail}`;
  }
  if (base === "/") return abs;
  return abs;
}

/** Find a node by backendNodeId inside a DOM.getDocument tree. */
export function findNodeByBackendId(
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
