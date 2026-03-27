import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import type {
  A11yNode,
  A11yOptions,
  AccessibilityTreeResult,
} from "../../../types/private/snapshot.js";
import {
  resolveObjectIdForCss,
  resolveObjectIdForXPath,
} from "./focusSelectors.js";
import { formatTreeLine, normaliseSpaces } from "./treeFormatUtils.js";

/**
 * Fetch and prune the accessibility tree for a frame, optionally scoping the
 * output to a selector root for faster targeted snapshots.
 */
export async function a11yForFrame(
  session: CDPSessionLike,
  frameId: string | undefined,
  opts: A11yOptions,
): Promise<AccessibilityTreeResult> {
  await session.send("Accessibility.enable").catch(() => {});
  await session.send("Runtime.enable").catch(() => {});
  await session.send("DOM.enable").catch(() => {});

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

  let scopeApplied = false;
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
      scopeApplied = true;
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
      return nodes;
    }
  })();

  const decorated = decorateRoles(nodesForOutline, opts);
  const { tree } = await buildHierarchicalTree(decorated, opts);

  const simplified = tree.map((n) => formatTreeLine(n)).join("\n");
  return { outline: simplified.trimEnd(), urlMap, scopeApplied };
}

export function decorateRoles(
  nodes: Protocol.Accessibility.AXNode[],
  opts: A11yOptions,
): A11yNode[] {
  const asRole = (n: Protocol.Accessibility.AXNode) =>
    String(n.role?.value ?? "");

  const decorated = nodes.map((n) => {
    let encodedId: string | undefined;
    if (typeof n.backendDOMNodeId === "number") {
      try {
        encodedId = opts.encode(n.backendDOMNodeId);
      } catch {
        //
      }
    }

    let role = asRole(n);

    const domIsScrollable = encodedId
      ? opts.scrollableMap[encodedId] === true
      : false;
    const tag = encodedId ? opts.tagNameMap[encodedId] : undefined;
    const isHtmlElement = tag === "html";
    if ((domIsScrollable || isHtmlElement) && tag !== "#document") {
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

  // Some AX nodes are virtual wrappers without a direct DOM backend node.
  // Proxy those nodes to the nearest real DOM-backed node so observe()/act()
  // can still resolve them through the existing xpath map.
  return resolveMissingEncodedIds(decorated);
}

function resolveMissingEncodedIds(nodes: A11yNode[]): A11yNode[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  return nodes.map((node) => {
    if (node.encodedId) return node;

    const descendantId = findNearestDescendantEncodedId(node, byId);
    if (descendantId) {
      return { ...node, encodedId: descendantId };
    }

    // If the node has no DOM-backed child, fall back to the closest DOM-backed
    // ancestor. This handles virtual text/label AX nodes nested inside controls.
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.encodedId) {
        return { ...node, encodedId: parent.encodedId };
      }
      parentId = parent.parentId;
    }

    return node;
  });
}

function findNearestDescendantEncodedId(
  start: A11yNode,
  byId: Map<string, A11yNode>,
): string | undefined {
  const seen = new Set<string>();
  let queue = [...(start.childIds ?? [])];

  while (queue.length) {
    const nextLevel: string[] = [];
    const candidates: A11yNode[] = [];

    for (const nodeId of queue) {
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);

      const node = byId.get(nodeId);
      if (!node) continue;
      if (node.encodedId) {
        candidates.push(node);
        continue;
      }
      for (const childId of node.childIds ?? []) {
        nextLevel.push(childId);
      }
    }

    if (candidates.length > 0) {
      return candidates.sort((a, b) => scoreProxyNode(b) - scoreProxyNode(a))[0]
        ?.encodedId;
    }

    queue = nextLevel;
  }

  return undefined;
}

function scoreProxyNode(node: A11yNode): number {
  const role = node.role.toLowerCase();
  const actionable =
    role === "button" ||
    role === "link" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "textbox" ||
    role === "combobox" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "option";

  return (actionable ? 10 : 0) + (node.name?.trim() ? 1 : 0);
}

export async function buildHierarchicalTree(
  nodes: A11yNode[],
  opts: A11yOptions,
): Promise<{ tree: A11yNode[] }> {
  const nodeMap = new Map<string, A11yNode>();

  for (const n of nodes) {
    const keep =
      !!(n.name && n.name.trim()) ||
      !!(n.childIds && n.childIds.length) ||
      !isStructural(n.role);
    if (!keep) continue;
    nodeMap.set(n.nodeId, { ...n });
  }

  for (const n of nodes) {
    if (!n.parentId) continue;
    const parent = nodeMap.get(n.parentId);
    const cur = nodeMap.get(n.nodeId);
    if (parent && cur) (parent.children ??= []).push(cur);
  }

  const roots = nodes
    .filter((n) => !n.parentId && nodeMap.has(n.nodeId))
    .map((n) => nodeMap.get(n.nodeId)!) as A11yNode[];

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

    const prunedStatic = removeRedundantStaticTextChildren(node, cleanedKids);

    if (isStructural(node.role)) {
      if (prunedStatic.length === 1) return prunedStatic[0]!;
      if (prunedStatic.length === 0) return null;
    }

    let newRole = node.role;
    if ((newRole === "generic" || newRole === "none") && node.encodedId) {
      const tagName = opts.tagNameMap[node.encodedId];
      if (tagName) newRole = tagName;
    }

    if (newRole === "combobox" && node.encodedId) {
      const tagName = opts.tagNameMap[node.encodedId];
      if (tagName === "select") newRole = "select";
    }

    return { ...node, role: newRole, children: prunedStatic };
  }
}

export function isStructural(role: string): boolean {
  const r = role?.toLowerCase();
  return r === "generic" || r === "none" || r === "inlinetextbox";
}

export function extractUrlFromAXNode(
  ax: Protocol.Accessibility.AXNode,
): string | undefined {
  const props = ax.properties ?? [];
  const urlProp = props.find((p) => p.name === "url");
  const value = urlProp?.value?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function removeRedundantStaticTextChildren(
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
