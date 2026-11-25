import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { type Progress, runLocatorStep } from "../../progress.js";
import type { SessionDomIndex } from "../../../types/private/snapshot.js";
import { buildChildXPathSegments, joinXPath, normalizeXPath } from "./xpathUtils.js";

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

export function mergeDomNodes(target: Protocol.DOM.Node, source: Protocol.DOM.Node): void {
  target.childNodeCount = source.childNodeCount ?? target.childNodeCount;
  target.children = source.children ?? target.children;
  target.shadowRoots = source.shadowRoots ?? target.shadowRoots;
  target.contentDocument = source.contentDocument ?? target.contentDocument;
}

export function collectDomTraversalTargets(node: Protocol.DOM.Node): Protocol.DOM.Node[] {
  const targets: Protocol.DOM.Node[] = [];
  if (node.children) targets.push(...node.children);
  if (node.shadowRoots) targets.push(...node.shadowRoots);
  if (node.contentDocument) targets.push(node.contentDocument);
  return targets;
}

export async function hydrateDomTree(
  session: CDPSessionLike,
  root: Protocol.DOM.Node,
  pierce: boolean,
  progress?: Progress,
): Promise<void> {
  const stack: Protocol.DOM.Node[] = [root];
  const expandedNodeIds = new Set<number>();
  const expandedBackendIds = new Set<number>();
  const visitedNodes = new WeakSet<Protocol.DOM.Node>();

  while (stack.length) {
    progress?.throwIfStopped();
    const node = stack.pop()!;
    if (visitedNodes.has(node)) continue;
    visitedNodes.add(node);
    const nodeId = typeof node.nodeId === "number" && node.nodeId > 0 ? node.nodeId : undefined;
    const backendId =
      typeof node.backendNodeId === "number" && node.backendNodeId > 0
        ? node.backendNodeId
        : undefined;

    const seenByNode = nodeId ? expandedNodeIds.has(nodeId) : false;
    const seenByBackend = !nodeId && backendId ? expandedBackendIds.has(backendId) : false;
    if (seenByNode || seenByBackend) continue;
    if (nodeId) expandedNodeIds.add(nodeId);
    else if (backendId) expandedBackendIds.add(backendId);

    const needsExpansion = shouldExpandNode(node);
    if (needsExpansion && (nodeId || backendId)) {
      const describeParamsBase = nodeId ? { nodeId } : { backendNodeId: backendId! };
      let expanded = false;
      let lastRetryError: unknown;
      for (const depth of DESCRIBE_DEPTH_ATTEMPTS) {
        try {
          const described = await runLocatorStep(progress, "expanding snapshot DOM", () =>
            session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", {
              ...describeParamsBase,
              depth,
              pierce,
            }),
          );
          if (described?.node) {
            mergeDomNodes(node, described.node);
            if (!nodeId && described.node.nodeId && described.node.nodeId > 0) {
              node.nodeId = described.node.nodeId;
              expandedNodeIds.add(described.node.nodeId);
            }
          }
          expanded = true;
          break;
        } catch (err) {
          progress?.throwIfStopped();
          const message = err instanceof Error ? err.message : String(err);
          if (isCborStackError(message)) {
            lastRetryError = err;
            continue;
          }
          throw err;
        }
      }
      if (!expanded) {
        if (lastRetryError !== undefined) throw lastRetryError;
        throw new Error("Unable to expand DOM node after describeNode depth retries");
      }
    }

    for (const child of collectDomTraversalTargets(node)) {
      stack.push(child);
    }
  }
}

export async function getDomTreeWithFallback(
  session: CDPSessionLike,
  pierce: boolean,
  progress?: Progress,
): Promise<Protocol.DOM.Node> {
  let lastRetryError: unknown;

  for (const depth of DOM_DEPTH_ATTEMPTS) {
    try {
      const { root } = await runLocatorStep(progress, "reading snapshot DOM", () =>
        session.send<{ root: Protocol.DOM.Node }>("DOM.getDocument", { depth, pierce }),
      );

      if (depth !== -1) {
        await hydrateDomTree(session, root, pierce, progress);
      }

      return root;
    } catch (err) {
      progress?.throwIfStopped();
      const message = err instanceof Error ? err.message : String(err);
      if (isCborStackError(message)) {
        lastRetryError = err;
        continue;
      }
      throw err;
    }
  }

  if (lastRetryError !== undefined) throw lastRetryError;
  throw new Error("CDP DOM.getDocument failed after adaptive depth retries");
}

export async function domMapsForSession(
  session: CDPSessionLike,
  frameId: string,
  pierce: boolean,
  encode: (fid: string, backendNodeId: number) => string,
  attemptOwnerLookup = true,
  progress?: Progress,
): Promise<{
  tagNameMap: Record<string, string>;
  xpathMap: Record<string, string>;
  scrollableMap: Record<string, boolean>;
}> {
  await runLocatorStep(progress, "enabling DOM", () => session.send("DOM.enable").catch(() => {}));
  const root = await getDomTreeWithFallback(session, pierce, progress);

  let startNode: Protocol.DOM.Node = root;
  if (attemptOwnerLookup) {
    try {
      const owner = await runLocatorStep(progress, "finding snapshot iframe owner", () =>
        session.send<{ backendNodeId?: number }>("DOM.getFrameOwner", { frameId }),
      );
      const ownerBackendId = owner.backendNodeId;
      if (typeof ownerBackendId === "number") {
        const ownerEl = findNodeByBackendId(root, ownerBackendId);
        if (ownerEl?.contentDocument) {
          startNode = ownerEl.contentDocument;
        }
      }
    } catch {
      progress?.throwIfStopped();
    }
  }

  const tagNameMap: Record<string, string> = {};
  const xpathMap: Record<string, string> = {};
  const scrollableMap: Record<string, boolean> = {};

  type StackEntry = { node: Protocol.DOM.Node; xpath: string };
  const stack: StackEntry[] = [{ node: startNode, xpath: "" }];
  const visited = new WeakSet<Protocol.DOM.Node>();

  while (stack.length) {
    progress?.throwIfStopped();
    const { node, xpath } = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);

    if (node.backendNodeId) {
      const encId = encode(frameId, node.backendNodeId);
      tagNameMap[encId] = enrichedTagName(node);
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

  progress?.throwIfStopped();
  return { tagNameMap, xpathMap, scrollableMap };
}

export async function buildSessionDomIndex(
  session: CDPSessionLike,
  pierce: boolean,
  progress?: Progress,
): Promise<SessionDomIndex> {
  await runLocatorStep(progress, "enabling DOM", () => session.send("DOM.enable").catch(() => {}));
  // CDP uses one piercing flag for both shadow roots and iframe documents.
  // Fetch both, then independently omit shadow roots while building the index.
  const root = await getDomTreeWithFallback(session, true, progress);

  const absByBe = new Map<number, string>();
  const tagByBe = new Map<number, string>();
  const scrollByBe = new Map<number, boolean>();
  const docRootOf = new Map<number, number>();
  const contentDocRootByIframe = new Map<number, number>();
  const enterByBe = new Map<number, number>();
  const exitByBe = new Map<number, number>();

  type Entry = {
    node: Protocol.DOM.Node;
    xp: string;
    docRootBe: number;
    phase: "enter" | "exit";
  };
  const rootBe = root.backendNodeId!;
  const stack: Entry[] = [{ node: root, xp: "/", docRootBe: rootBe, phase: "enter" }];
  const visited = new WeakSet<Protocol.DOM.Node>();
  let dfsIndex = 0;

  while (stack.length) {
    progress?.throwIfStopped();
    const { node, xp, docRootBe, phase } = stack.pop()!;
    if (phase === "exit") {
      if (node.backendNodeId) {
        exitByBe.set(node.backendNodeId, dfsIndex++);
      }
      continue;
    }

    if (visited.has(node)) continue;
    visited.add(node);

    if (node.backendNodeId) {
      enterByBe.set(node.backendNodeId, dfsIndex++);
      absByBe.set(node.backendNodeId, xp || "/");
      tagByBe.set(node.backendNodeId, enrichedTagName(node));
      if (node?.isScrollable === true) scrollByBe.set(node.backendNodeId, true);
      docRootOf.set(node.backendNodeId, docRootBe);
    }

    stack.push({ node, xp, docRootBe, phase: "exit" });

    const kids = node.children ?? [];
    if (kids.length) {
      const segs = buildChildXPathSegments(kids);
      for (let i = kids.length - 1; i >= 0; i--) {
        const child = kids[i]!;
        const step = segs[i]!;
        stack.push({
          node: child,
          xp: joinXPath(xp, step),
          docRootBe,
          phase: "enter",
        });
      }
    }

    for (const sr of pierce ? (node.shadowRoots ?? []) : []) {
      stack.push({
        node: sr,
        xp: joinXPath(xp, "//"),
        docRootBe,
        phase: "enter",
      });
    }

    const cd = node.contentDocument as Protocol.DOM.Node | undefined;
    if (cd && typeof cd.backendNodeId === "number") {
      if (typeof node.backendNodeId === "number") {
        contentDocRootByIframe.set(node.backendNodeId, cd.backendNodeId);
      }
      stack.push({
        node: cd,
        xp,
        docRootBe: cd.backendNodeId,
        phase: "enter",
      });
    }
  }

  progress?.throwIfStopped();
  return {
    rootBackend: rootBe,
    absByBe,
    tagByBe,
    scrollByBe,
    docRootOf,
    contentDocRootByIframe,
    enterByBe,
    exitByBe,
  };
}

export function relativizeXPath(baseAbs: string, nodeAbs: string): string {
  const base = normalizeXPath(baseAbs);
  const abs = normalizeXPath(nodeAbs);
  if (!abs || abs === base) return "/";
  if (!base || base === "/") return abs;
  if (base.endsWith("//")) {
    if (abs.startsWith(base)) {
      const tail = abs.slice(base.length);
      return tail ? `/${tail}` : "/";
    }
    return abs;
  }
  if (abs.startsWith(`${base}/`)) {
    return abs.slice(base.length);
  }
  return abs;
}

/**
 * Extract an attribute value from a CDP DOM node's flat attributes array.
 * Attributes are stored as [name1, value1, name2, value2, ...].
 */
function getAttr(attrs: string[] | undefined, name: string): string | undefined {
  if (!attrs) return undefined;
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1];
  }
  return undefined;
}

function enrichedTagName(node: Protocol.DOM.Node): string {
  const tag = String(node.nodeName).toLowerCase();
  if (tag === "input") {
    const type = getAttr(node.attributes, "type");
    if (type) return `input, ${type}`;
  }
  return tag;
}

export function findNodeByBackendId(
  root: Protocol.DOM.Node,
  backendNodeId: number,
): Protocol.DOM.Node | undefined {
  const stack: Protocol.DOM.Node[] = [root];
  const visited = new WeakSet<Protocol.DOM.Node>();
  while (stack.length) {
    const n = stack.pop()!;
    if (visited.has(n)) continue;
    visited.add(n);
    if (n.backendNodeId === backendNodeId) return n;
    if (n.children) for (const c of n.children) stack.push(c);
    if (n.shadowRoots) for (const s of n.shadowRoots) stack.push(s);
    if (n.contentDocument) stack.push(n.contentDocument);
  }
  return undefined;
}
