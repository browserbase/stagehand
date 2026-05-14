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
import {
  A11Y_STATE_CHECKED,
  A11Y_STATE_SELECTED,
  AX_BOOLEAN_FALSE_NUMBER,
  AX_BOOLEAN_FALSE_STRING,
  AX_BOOLEAN_TRUE_NUMBER,
  AX_BOOLEAN_TRUE_STRING,
} from "./constants.js";
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

  const filteredNodes = nodesForOutline.filter((node) => {
    const be = node.backendDOMNodeId;
    return typeof be !== "number" || !opts.isIgnoredBackendNode?.(be);
  });

  const urlMap: Record<string, string> = {};
  for (const n of filteredNodes) {
    const be = n.backendDOMNodeId;
    if (typeof be !== "number") continue;
    const url = extractUrlFromAXNode(n);
    if (!url) continue;
    const enc = opts.encode(be);
    urlMap[enc] = url;
  }

  const decorated = decorateRoles(filteredNodes, opts);
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

  return nodes.map((n) => {
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

    // File inputs typically get role "button" from Chrome's AX tree;
    // override so they appear as "input, file" in the outline.
    if (tag === "input, file") {
      role = tag;
    }

    const state = resolveA11yState(n);

    return {
      role,
      name: n.name?.value,
      description: n.description?.value,
      value: n.value?.value,
      state,
      nodeId: n.nodeId,
      backendDOMNodeId: n.backendDOMNodeId,
      parentId: n.parentId,
      childIds: n.childIds,
      encodedId,
    };
  });
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


function toBoolean(
  value: Protocol.Accessibility.AXValue | undefined,
): boolean | undefined {
  const raw = value?.value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === AX_BOOLEAN_TRUE_NUMBER) return true;
    if (raw === AX_BOOLEAN_FALSE_NUMBER) return false;
  }
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (normalized === AX_BOOLEAN_TRUE_STRING) return true;
    if (normalized === AX_BOOLEAN_FALSE_STRING) return false;
  }
  return undefined;
}

function extractBooleanState(
  node: Protocol.Accessibility.AXNode,
  stateName: string,
): boolean | undefined {
  const directValue = (
    node as unknown as Record<string, Protocol.Accessibility.AXValue | undefined>
  )[stateName];
  const direct = toBoolean(directValue);
  if (direct !== undefined) return direct;

  const fromProperties = node.properties?.find((prop) => prop.name === stateName);
  return toBoolean(fromProperties?.value);
}

function resolveA11yState(
  node: Protocol.Accessibility.AXNode,
): A11yNode["state"] {
  const checked = extractBooleanState(node, A11Y_STATE_CHECKED);
  if (checked === true) return A11Y_STATE_CHECKED;

  const selected = extractBooleanState(node, A11Y_STATE_SELECTED);
  if (selected === true) return A11Y_STATE_SELECTED;

  return undefined;
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
