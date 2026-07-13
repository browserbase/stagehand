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

  let scopeApplied = false;
  let scopedRootBackendNodeId: number | undefined;
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
      if (!target) {
        scopeApplied = true;
        scopedRootBackendNodeId = be;
        if (isEncodedFileInput(opts.encode(be), opts)) {
          return [];
        }
        return nodes;
      }
      scopeApplied = true;
      scopedRootBackendNodeId = be;
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
  const treeWithFileInputs = appendMissingFileInputNodes(
    tree,
    decorated,
    opts,
    scopedRootBackendNodeId,
  );

  const simplified = treeWithFileInputs
    .map((n) => formatTreeLine(n))
    .join("\n");
  return { outline: simplified.trimEnd(), urlMap, scopeApplied };
}

function isEncodedFileInput(encodedId: string, opts: A11yOptions): boolean {
  const tag = String(opts.tagNameMap[encodedId] ?? "").toLowerCase();
  if (tag === "input, file") return true;
  const inputType = opts.inputTypeMap?.[encodedId];
  return tag === "input" && String(inputType ?? "").toLowerCase() === "file";
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
    if (encodedId && isEncodedFileInput(encodedId, opts)) {
      role = "input, file";
    }

    return {
      role,
      name: n.name?.value,
      description: n.description?.value,
      value: n.value?.value,
      selected: extractBooleanProperty(n, "selected"),
      checked: extractBooleanProperty(n, "checked"),
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
      !isStructural(n.role) ||
      isFileInputNode(n, opts);
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
      if (isFileInputNode(node, opts)) {
        return { ...node, role: "input, file" };
      }
      return isStructural(node.role) ? null : node;
    }

    const cleanedKids = (
      await Promise.all(children.map(pruneStructuralSafe))
    ).filter(Boolean) as A11yNode[];

    const prunedStatic = removeRedundantStaticTextChildren(node, cleanedKids);

    if (isStructural(node.role) && !isFileInputNode(node, opts)) {
      if (prunedStatic.length === 1) return prunedStatic[0]!;
      if (prunedStatic.length === 0) return null;
    }

    let newRole = node.role;
    if (isFileInputNode(node, opts)) {
      newRole = "input, file";
    }
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

function isFileInputNode(node: A11yNode, opts: A11yOptions): boolean {
  if (!node.encodedId) return false;
  return isEncodedFileInput(node.encodedId, opts);
}

function collectEncodedIds(
  nodes: A11yNode[],
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.encodedId) out.add(node.encodedId);
    if (node.children?.length) collectEncodedIds(node.children, out);
  }
  return out;
}

export function appendMissingFileInputNodes(
  tree: A11yNode[],
  decorated: A11yNode[],
  opts: A11yOptions,
  scopedRootBackendNodeId?: number,
): A11yNode[] {
  const presentEncodedIds = collectEncodedIds(tree);
  const decoratedByEncoded = new Map<string, A11yNode>();
  for (const node of decorated) {
    if (node.encodedId && !decoratedByEncoded.has(node.encodedId)) {
      decoratedByEncoded.set(node.encodedId, node);
    }
  }

  const fileInputEncodedIds = new Set<string>();
  for (const [encodedId, tag] of Object.entries(opts.tagNameMap)) {
    if (String(tag).toLowerCase() === "input, file") {
      fileInputEncodedIds.add(encodedId);
    }
  }
  for (const [encodedId, inputType] of Object.entries(
    opts.inputTypeMap ?? {},
  )) {
    if (String(inputType).toLowerCase() === "file") {
      fileInputEncodedIds.add(encodedId);
    }
  }

  const extras: A11yNode[] = [];
  const hasScopedRoot = scopedRootBackendNodeId !== undefined;
  const scopedRootXpath = hasScopedRoot
    ? opts.xpathMap?.[opts.encode(scopedRootBackendNodeId)]
    : undefined;
  for (const encodedId of fileInputEncodedIds) {
    if (!isEncodedFileInput(encodedId, opts)) continue;
    if (presentEncodedIds.has(encodedId)) continue;
    const backendNodeId = opts.decode?.(encodedId);
    if (
      backendNodeId !== undefined &&
      opts.isIgnoredBackendNode?.(backendNodeId)
    ) {
      continue;
    }
    if (hasScopedRoot && scopedRootXpath === undefined) {
      continue;
    }
    if (scopedRootXpath !== undefined && scopedRootXpath !== "/") {
      const candidateXpath = opts.xpathMap?.[encodedId];
      if (
        candidateXpath !== scopedRootXpath &&
        !candidateXpath?.startsWith(`${scopedRootXpath}/`)
      ) {
        continue;
      }
    }

    const existing = decoratedByEncoded.get(encodedId);
    if (existing) {
      extras.push({
        ...existing,
        role: "input, file",
        children: undefined,
      });
      continue;
    }

    extras.push({
      role: "input, file",
      nodeId: `synthetic-file-${encodedId}`,
      encodedId,
    });
  }

  if (!extras.length) return tree;
  return [...tree, ...extras];
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
function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function extractBooleanProperty(
  node: Protocol.Accessibility.AXNode,
  propertyName: string,
): boolean | undefined {
  const value = node.properties?.find((p) => p.name === propertyName)?.value
    ?.value;
  return toBooleanValue(value);
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
