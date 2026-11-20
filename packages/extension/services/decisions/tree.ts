import { type OutlineNode } from "./outline.js";
export { parseOutline, markEditable, type OutlineNode } from "./outline.js";
import type { JsonValue } from "./client.js";

export type ViewKind = "pointer" | "input";

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

const LABEL_ROLES = new Set(["labeltext", "label"]);

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

/** True when the snapshot gave the node nothing to be recognised by. */
export function isNameless(nodes: OutlineNode[], node: OutlineNode): boolean {
  return !node.name && !descendants(nodes, node, 6).some((child) => child.name);
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

function insideNativeSelect(nodes: OutlineNode[], node: OutlineNode): boolean {
  for (let parent = node.parent; parent !== undefined; parent = nodes[parent]!.parent) {
    if (roleTokens(nodes[parent]!).includes("select")) return true;
  }
  return false;
}

/** The node's own name, or the text of its subtree read in order. */
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

/**
 * Structured description for one candidate. Ancestor, heading, and nearby-label
 * context is what separates otherwise identical lines like two `button: Edit`.
 */
const DESCRIPTIONS = new WeakMap<OutlineNode[], Map<string, Record<string, JsonValue>>>();

const TWIN_INDEX = new WeakMap<OutlineNode[], Map<string, OutlineNode[]>>();

/** Same role and name, from an index built once per snapshot (pages have thousands of nodes). */
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

/** Memoised per snapshot: pruning, shards, the pick and the trace all describe the same nodes. */
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
  // Icon-only controls have no accessible name; DOM attributes stand in for it.
  if (domHint) description.dom_attributes = truncate(domHint, 160);
  if (node.flags.length > 0) description.state = node.flags;

  const text = descendants(nodes, node, 20)
    .filter((child) => child.name && hasRole(child, TEXT_ROLES))
    .map((child) => child.name)
    .join(" ");
  if (text && text !== node.name) description.text = truncate(text, 120);

  if (insideIframe(nodes, node)) description.inside_iframe = true;

  // A table cell means nothing without its row and column.
  const table = tableContext(nodes, node);
  if (table) description.table = table;

  // Identical controls ("Add to cart" x12) are otherwise indistinguishable
  // and positional instructions ("the third result") have nothing to bind to.
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
  // Checkbox and radio labels usually FOLLOW the control.
  if (!node.name) {
    const after = followingSiblingText(nodes, node);
    if (after) description.text_after = truncate(after, 80);
  }

  // The card, table row or list item the control sits in: what tells one
  // "Add to cart" or "edit" from the next.
  const group = contextGroup(nodes, node);
  if (group) {
    const groupText = groupTextOf(nodes, group, node);
    // A nameless control whose surroundings run long is sitting in prose or
    // source code, not in a labelled item; that text would only mislead.
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

/** Row label (first cell of the row) and column header for a node inside a table cell. */
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

  // Header row: the first row of the enclosing table.
  let table: OutlineNode | undefined;
  for (let at = row.parent; at !== undefined; at = nodes[at]!.parent) {
    if (hasRole(nodes[at]!, TABLE_ROLES)) table = nodes[at]!;
    else if (table) break;
  }
  if (table) {
    // The header row must line up with this row: a title cell spanning the
    // table would shift every column. Prefer a row of real column headers,
    // else the first row of the same width.
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
    if (hasRole(candidate, TEXT_ROLES)) {
      // AX labels can own a StaticText child while having no name themselves.
      const label =
        candidate.name || (hasRole(candidate, LABEL_ROLES) ? textOf(nodes, candidate) : "");
      if (label) return label;
    }
    if (hasRole(candidate, POINTER_ROLES) || hasRole(candidate, INPUT_ROLES)) return undefined;
  }
  return undefined;
}

const GROUP_MAX_NODES = 60;

const GROUP_MAX_CONTROLS = 8;

/**
 * Nearest ancestor whose subtree says something beyond the node itself while
 * staying small enough to be one item (a card, a row), not the whole list.
 */
export function contextGroup(nodes: OutlineNode[], node: OutlineNode): OutlineNode | undefined {
  // Only twins and nameless controls need it; a uniquely named control is
  // already identified and its "group" would just be the surrounding form.
  const twins = sameNamed(nodes, node);
  if (node.name ? twins.length < 2 : !isNameless(nodes, node)) return undefined;

  for (let at = node.parent; at !== undefined; at = nodes[at]!.parent) {
    const ancestor = nodes[at]!;
    if (hasRole(ancestor, SCROLL_ROLES)) return undefined;
    const subtree = descendants(nodes, ancestor, GROUP_MAX_NODES + 1);
    if (subtree.length > GROUP_MAX_NODES) return undefined;
    // Past one item: the ancestor already spans several of the twins (a hover
    // overlay may duplicate a control once) or a whole toolbar of controls.
    const twinsInside = node.name ? subtree.filter((child) => twins.includes(child)).length : 0;
    const controls = subtree.filter(
      (child) => hasRole(child, POINTER_ROLES) || hasRole(child, INPUT_ROLES),
    ).length;
    if (twinsInside > 2 || (twinsInside > 1 && twinsInside === twins.length)) return undefined;
    if (controls > GROUP_MAX_CONTROLS) return undefined;
    // Sibling controls ("edit · delete") say nothing about which item this
    // is; keep climbing until the item's own text (a name cell, a title) is in.
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
    if (hasRole(candidate, TEXT_ROLES)) {
      // AX labels can own a StaticText child while having no name themselves.
      const label =
        candidate.name || (hasRole(candidate, LABEL_ROLES) ? textOf(nodes, candidate) : "");
      if (label) return label;
    }
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

/** Values only: object keys ("row", "column") are ours, not the page's. */
function flattenText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join(" ");
  return value === null ? "" : String(value);
}

function tokens(text: string): string[] {
  return (
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      // "15th" should find the calendar cell named "15".
      .map((token) => token.replace(/^(\d+)(st|nd|rd|th)$/, "$1"))
      .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
      .filter((token) => (token.length > 1 || /\d/.test(token)) && !STOPWORDS.has(token))
  );
}

/**
 * Lexical relevance of each candidate to the instruction, used to cut large
 * candidate lists down to one decision-model request. Own name counts most, then inner
 * text, then surrounding context. Zero means no shared word at all.
 */
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

export function buildView(nodes: OutlineNode[], kind: ViewKind): OutlineNode[] {
  return nodes.filter(
    (node) =>
      isAddressable(node) &&
      !insideNativeSelect(nodes, node) &&
      (kind === "pointer"
        ? hasRole(node, POINTER_ROLES)
        : hasRole(node, INPUT_ROLES) || node.editable === true),
  );
}
