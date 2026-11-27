import type { JsonValue } from "./typesafeClient.js";

export type OutlineNode = {
  id: string;
  role: string;
  name: string;
  flags: string[];
  depth: number;
  parent?: number;
  index: number;
  editable?: boolean;
};

export type ViewKind =
  | "pointer"
  | "input"
  | "select"
  | "scroll"
  | "option"
  | "broad"
  | "text"
  | "link";

const LINE = /^( *)\[([^\]]+)\] (.*)$/;
const FLAGS = /((?: \[(?:selected|checked)\])+)$/;
const ENCODED_ID = /^\d+-\d+$/;

const POINTER_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "switch",
  "option",
  "treeitem",
  "summary",
  "combobox",
  "listbox",
  "slider",
  "img",
  "image",
  "disclosuretriangle",
]);
const INPUT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "textarea"]);
const SELECT_ROLES = new Set(["combobox", "listbox", "select"]);
const OPTION_ROLES = new Set(["option", "menulistoption"]);
const TEXT_ROLES = new Set([
  "statictext",
  "labeltext",
  "listitem",
  "cell",
  "gridcell",
  "generic",
  "paragraph",
  "label",
  "menulistoption",
]);
const SCROLL_ROLES = new Set(["rootwebarea", "webarea", "iframe", "html", "document"]);

export function markEditable(
  nodes: OutlineNode[],
  editableIds: Iterable<string> | undefined,
): void {
  const editable = new Set(editableIds ?? []);
  if (editable.size === 0) return;
  for (const node of nodes) {
    if (!editable.has(node.id)) continue;
    const parent = node.parent === undefined ? undefined : nodes[node.parent];
    if (!parent || !editable.has(parent.id)) node.editable = true;
  }
}

export function isNameless(nodes: OutlineNode[], node: OutlineNode): boolean {
  return !node.name && !descendants(nodes, node, 6).some((child) => child.name);
}

export function parseOutline(tree: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const stack: number[] = [];

  for (const line of tree.split("\n")) {
    const match = LINE.exec(line);
    if (!match) {
      const previous = nodes[nodes.length - 1];
      if (previous && line.trim()) previous.name = `${previous.name} ${line.trim()}`.trim();
      continue;
    }
    const [, indent = "", id = "", rest = ""] = match;
    const depth = Math.floor(indent.length / 2);

    let body = rest;
    const flagMatch = FLAGS.exec(body);
    const flags = flagMatch
      ? [...flagMatch[1]!.matchAll(/\[(\w+)\]/g)].map((flag) => flag[1]!)
      : [];
    if (flagMatch) body = body.slice(0, -flagMatch[1]!.length);

    const separator = body.indexOf(": ");
    const role = (separator === -1 ? body : body.slice(0, separator)).trim();
    const name = separator === -1 ? "" : body.slice(separator + 2).trim();

    while (stack.length > 0 && nodes[stack[stack.length - 1]!]!.depth >= depth) stack.pop();
    const node: OutlineNode = {
      id,
      role,
      name,
      flags,
      depth,
      parent: stack[stack.length - 1],
      index: nodes.length,
    };
    nodes.push(node);
    stack.push(node.index);
  }

  return nodes;
}

function roleTokens(node: OutlineNode): string[] {
  return node.role
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
}

function hasRole(node: OutlineNode, roles: Set<string>): boolean {
  return roleTokens(node).some((token) => roles.has(token));
}

function isAddressable(node: OutlineNode): boolean {
  return ENCODED_ID.test(node.id);
}

export function buildView(nodes: OutlineNode[], kind: ViewKind): OutlineNode[] {
  const matches = (node: OutlineNode): boolean => {
    switch (kind) {
      case "pointer":
        return hasRole(node, POINTER_ROLES);
      case "input":
        return hasRole(node, INPUT_ROLES) || node.editable === true;
      case "select":
        return hasRole(node, SELECT_ROLES) || hasRole(node, POINTER_ROLES);
      case "scroll":
        return roleTokens(node).includes("scrollable");
      case "link":
        return roleTokens(node).includes("link");
      case "text":
        return (
          (node.name.length > 0 &&
            !hasRole(node, SCROLL_ROLES) &&
            !repeatsParentName(nodes, node)) ||
          isTextBlock(nodes, node)
        );
      case "broad":
        return (
          node.name.length > 0 && !hasRole(node, SCROLL_ROLES) && !repeatsParentName(nodes, node)
        );
      case "option":
        return hasRole(node, POINTER_ROLES) || (hasRole(node, TEXT_ROLES) && node.name.length > 0);
    }
  };
  const view = nodes.filter(
    (node) => isAddressable(node) && matches(node) && !insideNativeSelect(nodes, node),
  );
  if (kind === "scroll" && view.length === 0) {
    return nodes.filter((node) => isAddressable(node) && hasRole(node, SCROLL_ROLES));
  }
  return view;
}

function insideNativeSelect(nodes: OutlineNode[], node: OutlineNode): boolean {
  for (let parent = node.parent; parent !== undefined; parent = nodes[parent]!.parent) {
    if (roleTokens(nodes[parent]!).includes("select")) return true;
  }
  return false;
}

export function isMainDocumentScroller(nodes: OutlineNode[], node: OutlineNode): boolean {
  return roleTokens(node).includes("html") && !insideIframe(nodes, node);
}

const TEXT_BLOCK_ROLES = new Set([
  "paragraph",
  "cell",
  "gridcell",
  "listitem",
  "heading",
  "labeltext",
  "time",
  "term",
  "definition",
  "descriptionlistdetail",
  "descriptionlistterm",
  "p",
  "td",
  "th",
  "li",
  "dd",
  "dt",
  "span",
  "div",
  "blockquote",
  "caption",
  "figcaption",
]);
const TEXT_BLOCK_MAX_CHARS = 400;

function isTextBlock(nodes: OutlineNode[], node: OutlineNode): boolean {
  if (node.name || !hasRole(node, TEXT_BLOCK_ROLES)) return false;
  const pieces = descendants(nodes, node, 25);
  if (pieces.length < 2 || pieces.length >= 25) return false;
  if (
    pieces.some(
      (piece) =>
        !piece.name &&
        hasRole(piece, TEXT_BLOCK_ROLES) &&
        piece.depth === node.depth + 1 &&
        descendants(nodes, piece, 3).length > 1,
    )
  ) {
    return false;
  }
  const text = textOf(nodes, node);
  return text.length > 0 && text.length <= TEXT_BLOCK_MAX_CHARS;
}

export function textOf(nodes: OutlineNode[], node: OutlineNode): string {
  if (node.name) return node.name;
  const parts: string[] = [];
  for (const piece of descendants(nodes, node, 60)) {
    if (!piece.name || repeatsParentName(nodes, piece)) continue;
    parts.push(piece.name);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function repeatsParentName(nodes: OutlineNode[], node: OutlineNode): boolean {
  if (node.parent === undefined || !hasRole(node, TEXT_ROLES)) return false;
  const parent = nodes[node.parent]!;
  return parent.name === node.name && !hasRole(parent, SCROLL_ROLES);
}

export function nativeSelectOptions(nodes: OutlineNode[], node: OutlineNode): string[] {
  return nativeOptionNodes(nodes, node).map((child) => child.name);
}

export function selectedNativeOptions(nodes: OutlineNode[], node: OutlineNode): string[] {
  return nativeOptionNodes(nodes, node)
    .filter((child) => child.flags.includes("selected"))
    .map((child) => child.name);
}

function nativeOptionNodes(nodes: OutlineNode[], node: OutlineNode): OutlineNode[] {
  if (!roleTokens(node).includes("select")) return [];
  return descendants(nodes, node, 5000).filter(
    (child) => hasRole(child, OPTION_ROLES) && child.name.length > 0,
  );
}

const DESCRIPTIONS = new WeakMap<OutlineNode[], Map<string, Record<string, JsonValue>>>();
const TWIN_INDEX = new WeakMap<OutlineNode[], Map<string, OutlineNode[]>>();

function sameNamed(nodes: OutlineNode[], node: OutlineNode): OutlineNode[] {
  let index = TWIN_INDEX.get(nodes);
  if (!index) {
    index = new Map();
    for (const other of nodes) {
      const key = `${other.role}\u0000${other.name}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(other);
      else index.set(key, [other]);
    }
    TWIN_INDEX.set(nodes, index);
  }
  return index.get(`${node.role}\u0000${node.name}`) ?? [node];
}

export function describeCandidate(
  nodes: OutlineNode[],
  node: OutlineNode,
  domHint?: string,
): Record<string, JsonValue> {
  let cache = DESCRIPTIONS.get(nodes);
  if (!cache) DESCRIPTIONS.set(nodes, (cache = new Map()));
  const key = `${node.index}\u0000${domHint ?? ""}`;
  let description = cache.get(key);
  if (!description) cache.set(key, (description = buildDescription(nodes, node, domHint)));
  return { ...description };
}

function buildDescription(
  nodes: OutlineNode[],
  node: OutlineNode,
  domHint?: string,
): Record<string, JsonValue> {
  const description: Record<string, JsonValue> = { role: node.role };
  if (node.editable && !hasRole(node, INPUT_ROLES)) description.editable = true;
  if (node.name) description.name = truncate(node.name, 120);
  if (domHint) description.dom_attributes = truncate(domHint, 160);
  if (node.flags.length > 0) description.state = node.flags;

  const text = descendants(nodes, node, 20)
    .filter((child) => child.name && hasRole(child, TEXT_ROLES))
    .map((child) => child.name)
    .join(" ");
  if (text && text !== node.name) description.text = truncate(text, 120);

  if (insideIframe(nodes, node)) description.inside_iframe = true;

  const table = tableContext(nodes, node);
  if (table) description.table = table;

  if (node.name) {
    const twins = sameNamed(nodes, node);
    if (twins.length > 1) description.occurrence = `${twins.indexOf(node) + 1} of ${twins.length}`;
  }

  const within = namedAncestors(nodes, node, 3);
  if (within.length > 0) description.within = within;

  const heading = precedingHeading(nodes, node);
  if (heading) description.under_heading = truncate(heading, 80);

  const nearText = precedingSiblingText(nodes, node);
  if (nearText) description.near_text = truncate(nearText, 80);
  if (!node.name) {
    const after = followingSiblingText(nodes, node);
    if (after) description.text_after = truncate(after, 80);
  }

  const group = contextGroup(nodes, node);
  if (group) {
    const groupText = groupTextOf(nodes, group, node);
    if (groupText && (node.name || groupText.length <= 120)) {
      description.group_text = truncate(groupText, 160);
    }
  }

  return description;
}

function descendants(nodes: OutlineNode[], node: OutlineNode, limit: number): OutlineNode[] {
  const result: OutlineNode[] = [];
  for (let i = node.index + 1; i < nodes.length && result.length < limit; i++) {
    if (nodes[i]!.depth <= node.depth) break;
    result.push(nodes[i]!);
  }
  return result;
}

function insideIframe(nodes: OutlineNode[], node: OutlineNode): boolean {
  for (let parent = node.parent; parent !== undefined; parent = nodes[parent]!.parent) {
    if (roleTokens(nodes[parent]!).includes("iframe")) return true;
  }
  return false;
}

function namedAncestors(nodes: OutlineNode[], node: OutlineNode, limit: number): string[] {
  const result: string[] = [];
  let parent = node.parent;
  while (parent !== undefined && result.length < limit) {
    const ancestor = nodes[parent]!;
    if (ancestor.name && !hasRole(ancestor, TEXT_ROLES)) {
      result.push(`${ancestor.role}: ${truncate(ancestor.name, 60)}`);
    }
    parent = ancestor.parent;
  }
  return result;
}

function precedingHeading(nodes: OutlineNode[], node: OutlineNode): string | undefined {
  for (let i = node.index - 1; i >= 0 && i >= node.index - 200; i--) {
    const candidate = nodes[i]!;
    if (candidate.name && roleTokens(candidate).includes("heading")) return candidate.name;
  }
  return undefined;
}

const CELL_ROLES = new Set([
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "td",
  "th",
  "layouttablecell",
]);
const TABLE_ROLES = new Set(["table", "grid", "treegrid", "layouttable", "rowgroup"]);

function tableContext(
  nodes: OutlineNode[],
  node: OutlineNode,
): Record<string, JsonValue> | undefined {
  let cell: OutlineNode | undefined;
  let row: OutlineNode | undefined;
  for (let at: number | undefined = node.index; at !== undefined; at = nodes[at]!.parent) {
    const current = nodes[at]!;
    if (
      roleTokens(current).includes("row") ||
      roleTokens(current).includes("layouttablerow") ||
      roleTokens(current).includes("tr")
    ) {
      row = current;
      break;
    }
    if (hasRole(current, CELL_ROLES)) cell = current;
  }
  if (!row || !cell) return undefined;

  const cellsOf = (parent: OutlineNode) =>
    descendants(nodes, parent, 80).filter(
      (child) => child.parent === parent.index && hasRole(child, CELL_ROLES),
    );
  const cells = cellsOf(row);
  const column = cells.indexOf(cell);
  if (column < 0) return undefined;

  const context: Record<string, JsonValue> = {};
  const first = cells[0];
  if (first && first.index !== cell.index) {
    const label = textOf(nodes, first);
    if (label) context.row = truncate(label, 80);
  }

  let table: OutlineNode | undefined;
  for (let at = row.parent; at !== undefined; at = nodes[at]!.parent) {
    if (hasRole(nodes[at]!, TABLE_ROLES)) table = nodes[at]!;
    else if (table) break;
  }
  if (table) {
    const rows = descendants(nodes, table, 400).filter(
      (child) =>
        child.index < row.index &&
        (roleTokens(child).includes("row") ||
          roleTokens(child).includes("layouttablerow") ||
          roleTokens(child).includes("tr")) &&
        cellsOf(child).length === cells.length,
    );
    const headerRow =
      rows.find((candidate) =>
        cellsOf(candidate).every((header) => roleTokens(header).includes("columnheader")),
      ) ?? rows[0];
    if (headerRow) {
      const header = cellsOf(headerRow)[column];
      const label = header ? textOf(nodes, header) : "";
      if (label) context.column = truncate(label, 60);
    }
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function followingSiblingText(nodes: OutlineNode[], node: OutlineNode): string | undefined {
  let end = node.index + 1;
  while (end < nodes.length && nodes[end]!.depth > node.depth) end++;
  for (let i = end; i < nodes.length && i < end + 6; i++) {
    const candidate = nodes[i]!;
    if (candidate.depth < node.depth) return undefined;
    if (candidate.parent !== node.parent) continue;
    if (candidate.name && hasRole(candidate, TEXT_ROLES)) return candidate.name;
    if (hasRole(candidate, POINTER_ROLES) || hasRole(candidate, INPUT_ROLES)) return undefined;
  }
  return undefined;
}

const GROUP_MAX_NODES = 60;
const GROUP_MAX_CONTROLS = 8;

export function contextGroup(nodes: OutlineNode[], node: OutlineNode): OutlineNode | undefined {
  const twins = sameNamed(nodes, node);
  if (node.name ? twins.length < 2 : !isNameless(nodes, node)) return undefined;

  for (let at = node.parent; at !== undefined; at = nodes[at]!.parent) {
    const ancestor = nodes[at]!;
    if (hasRole(ancestor, SCROLL_ROLES)) return undefined;
    const subtree = descendants(nodes, ancestor, GROUP_MAX_NODES + 1);
    if (subtree.length > GROUP_MAX_NODES) return undefined;
    const twinsInside = node.name ? subtree.filter((child) => twins.includes(child)).length : 0;
    const controls = subtree.filter(
      (child) => hasRole(child, POINTER_ROLES) || hasRole(child, INPUT_ROLES),
    ).length;
    if (twinsInside > 2 || (twinsInside > 1 && twinsInside === twins.length)) return undefined;
    if (controls > GROUP_MAX_CONTROLS) return undefined;
    const informative = subtree.some(
      (child) =>
        child.name &&
        child.name !== node.name &&
        !isInside(nodes, child, node) &&
        !hasRole(child, POINTER_ROLES) &&
        !hasRole(child, INPUT_ROLES) &&
        !(child.parent !== undefined && hasRole(nodes[child.parent]!, POINTER_ROLES)),
    );
    if (informative) return ancestor;
  }
  return undefined;
}

function isInside(nodes: OutlineNode[], node: OutlineNode, container: OutlineNode): boolean {
  for (let at: number | undefined = node.index; at !== undefined; at = nodes[at]!.parent) {
    if (at === container.index) return true;
  }
  return false;
}

function groupTextOf(nodes: OutlineNode[], group: OutlineNode, node: OutlineNode): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  if (group.name) parts.push(group.name);
  for (const child of descendants(nodes, group, GROUP_MAX_NODES)) {
    if (!child.name || child.name === node.name || seen.has(child.name)) continue;
    if (repeatsParentName(nodes, child)) continue;
    seen.add(child.name);
    parts.push(child.name);
  }
  return parts.join(" · ");
}

function precedingSiblingText(nodes: OutlineNode[], node: OutlineNode): string | undefined {
  const floor = node.parent ?? -1;
  for (let i = node.index - 1; i > floor && i >= node.index - 20; i--) {
    const candidate = nodes[i]!;
    if (candidate.parent !== node.parent) continue;
    if (candidate.name && hasRole(candidate, TEXT_ROLES)) return candidate.name;
    if (hasRole(candidate, POINTER_ROLES) || hasRole(candidate, INPUT_ROLES)) return undefined;
  }
  return undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const STOPWORDS = new Set(
  (
    "the a an to of in on into onto for and or at by from with that this it is be as then " +
    "click press tap type enter fill select choose pick open close check uncheck toggle scroll hover drag drop " +
    "button link field box input dropdown menu option tab page item element icon please make sure"
  ).split(" "),
);

function flattenText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join(" ");
  return value === null ? "" : String(value);
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => token.replace(/^(\d+)(st|nd|rd|th)$/, "$1"))
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => (token.length > 1 || /\d/.test(token)) && !STOPWORDS.has(token));
}

export function scoreCandidates(
  nodes: OutlineNode[],
  candidates: OutlineNode[],
  instruction: string,
): Map<string, number> {
  const wanted = new Set(tokens(instruction));
  const overlap = (text: JsonValue | undefined): number => {
    if (!text) return 0;
    const flat = flattenText(text);
    return new Set(tokens(flat).filter((token) => wanted.has(token))).size;
  };
  const scores = new Map<string, number>();
  for (const candidate of candidates) {
    const description = describeCandidate(nodes, candidate);
    scores.set(
      candidate.id,
      3 * overlap(description.name) +
        2 * overlap(description.text) +
        overlap(description.within) +
        overlap(description.under_heading) +
        overlap(description.near_text) +
        overlap(description.group_text) +
        2 * overlap(description.table),
    );
  }
  return scores;
}

export function indistinguishableTwins(nodes: OutlineNode[], node: OutlineNode): OutlineNode[] {
  const key = (candidate: OutlineNode) => {
    const { occurrence: _occurrence, ...rest } = describeCandidate(nodes, candidate);
    return JSON.stringify(rest);
  };
  const wanted = key(node);
  return sameNamed(nodes, node).filter((other) => key(other) === wanted);
}

export function nearbyTwins(nodes: OutlineNode[], node: OutlineNode): OutlineNode[] {
  if (!node.name) return [node];
  const group = contextGroup(nodes, node);
  const scope = group?.parent !== undefined ? nodes[group.parent]! : group;
  if (!scope) return [node];
  const twins = [scope, ...descendants(nodes, scope, 200)].filter(
    (other) => other.role === node.role && other.name === node.name,
  );
  return twins.length >= 2 && twins.length <= 3 ? twins : [node];
}

export function insideEditable(nodes: OutlineNode[], node: OutlineNode): boolean {
  if (node.parent === undefined || !roleTokens(node).includes("statictext")) return false;
  return hasRole(nodes[node.parent]!, INPUT_ROLES);
}

export function exactNameMatches(candidates: OutlineNode[], quoted: string): OutlineNode[] {
  const wanted = quoted.trim().toLowerCase();
  return candidates.filter((candidate) => candidate.name.trim().toLowerCase() === wanted);
}

export function focusOutline(nodes: OutlineNode[], ids: Iterable<string>): string {
  const wanted = new Set(ids);
  const keep = new Set<number>();
  for (const node of nodes) {
    if (!wanted.has(node.id)) continue;
    for (let at: number | undefined = node.index; at !== undefined; at = nodes[at]!.parent)
      keep.add(at);
    for (const child of descendants(nodes, node, 40)) keep.add(child.index);
    const group = contextGroup(nodes, node);
    if (group)
      for (const child of descendants(nodes, group, GROUP_MAX_NODES)) keep.add(child.index);
  }
  return nodes
    .filter((node) => keep.has(node.index))
    .map(
      (node) =>
        `${"  ".repeat(node.depth)}[${node.id}] ${node.role}${node.name ? `: ${node.name}` : ""}${node.flags
          .map((flag) => ` [${flag}]`)
          .join("")}`,
    )
    .join("\n");
}

export function pageDigest(nodes: OutlineNode[], limit = 40): Record<string, JsonValue> {
  const root = nodes.find((node) => roleTokens(node).includes("rootwebarea"));
  const lines: string[] = [];
  for (const node of nodes) {
    if (lines.length >= limit) break;
    if (!node.name || roleTokens(node).includes("rootwebarea")) continue;
    if (repeatsParentName(nodes, node)) continue;
    lines.push(`${node.role}: ${truncate(node.name, 140)}`);
  }
  return {
    title: root?.name ?? "",
    element_count: nodes.length,
    inputs: nodes.filter((node) => hasRole(node, INPUT_ROLES)).length,
    first_content: lines,
  };
}
