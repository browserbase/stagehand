import type { JsonValue } from "./typesafeClient.js";

/**
 * Parses the hybrid snapshot outline back into nodes so the Jev act pipeline
 * can build role-filtered candidate views. Lines follow `formatTreeLine`:
 * `[frame-node] role: name [selected] [checked]`, two spaces per depth.
 */
export type OutlineNode = {
  id: string;
  role: string;
  name: string;
  flags: string[];
  depth: number;
  parent?: number;
  index: number;
  /** Topmost node of an editable region per the browser (covers contenteditable). */
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

/**
 * Flags editable regions from the snapshot's side channel. A contenteditable
 * paragraph has role `paragraph`; without this it never reaches the fill view
 * and the nearest real textbox gets filled instead.
 */
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

/** True when the snapshot gave the node nothing to be recognised by. */
export function isNameless(nodes: OutlineNode[], node: OutlineNode): boolean {
  return !node.name && !descendants(nodes, node, 6).some((child) => child.name);
}

export function parseOutline(tree: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const stack: number[] = [];

  for (const line of tree.split("\n")) {
    const match = LINE.exec(line);
    if (!match) {
      // Names are not newline-stripped by the producer; a line without an id
      // is the continuation of the previous node's name.
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

/** Candidate nodes for a family. `option` is the post-expand view for custom dropdowns. */
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
        // Anything whose text could BE a value: named nodes, plus nameless
        // blocks (a paragraph with inline links) whose pieces read as one value.
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
  // A native select's options are arguments, not targets: offered alongside
  // the select they split the vote with it (and balloon the candidate count).
  const view = nodes.filter(
    (node) => isAddressable(node) && matches(node) && !insideNativeSelect(nodes, node),
  );
  // A document's RootWebArea and its `scrollable, html` are the same scroller;
  // offering both splits the probability mass. Roots only stand in when the
  // snapshot marked nothing scrollable.
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

/** True for a scroll candidate that is the top-level document rather than an iframe or container. */
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
  // A block of blocks is a container, not a value.
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
 * Option labels of a native <select>, which the snapshot renames to role
 * `select` (`scrollable, select` for list boxes). ARIA listboxes/comboboxes
 * also have option children but `selectOption` silently no-ops on them, so
 * they must go through the click flow instead.
 */
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
    if (candidate.name && hasRole(candidate, TEXT_ROLES)) return candidate.name;
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
 * candidate lists down to one Jev request. Own name counts most, then inner
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

/** Other nodes Jev cannot tell from this one: same description apart from the "n of m" ordinal. */
export function indistinguishableTwins(nodes: OutlineNode[], node: OutlineNode): OutlineNode[] {
  const key = (candidate: OutlineNode) => {
    const { occurrence: _occurrence, ...rest } = describeCandidate(nodes, candidate);
    return JSON.stringify(rest);
  };
  const wanted = key(node);
  return sameNamed(nodes, node).filter((other) => key(other) === wanted);
}

/**
 * Same-named copies of a control inside the same item: a product card's hover
 * overlay repeats its "Add to cart", a row repeats its link for small screens.
 */
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

/**
 * True for the text an editable control echoes back as its own child. Options
 * can legitimately live under a combobox (aria-owns), so only bare text counts.
 */
export function insideEditable(nodes: OutlineNode[], node: OutlineNode): boolean {
  if (node.parent === undefined || !roleTokens(node).includes("statictext")) return false;
  return hasRole(nodes[node.parent]!, INPUT_ROLES);
}

/** Candidates whose accessible name equals the quoted target exactly (case-insensitive). */
export function exactNameMatches(candidates: OutlineNode[], quoted: string): OutlineNode[] {
  const wanted = quoted.trim().toLowerCase();
  return candidates.filter((candidate) => candidate.name.trim().toLowerCase() === wanted);
}

/**
 * The outline reduced to the given nodes, their ancestors and their subtrees,
 * in the original line format. Handed to the LLM fallback in place of the
 * whole page when Jev narrowed the choice but could not commit.
 */
export function focusOutline(nodes: OutlineNode[], ids: Iterable<string>): string {
  const wanted = new Set(ids);
  const keep = new Set<number>();
  for (const node of nodes) {
    if (!wanted.has(node.id)) continue;
    for (let at: number | undefined = node.index; at !== undefined; at = nodes[at]!.parent)
      keep.add(at);
    for (const child of descendants(nodes, node, 40)) keep.add(child.index);
    // The card or row around it carries what tells it from its twins.
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

/** A compact page digest for page-state questions: title plus the first visible headings and text. */
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
