/**
 * Context reduction for the Stagehand accessibility tree.
 *
 * The raw tree is 3-5x larger than a caller needs: most lines are anonymous
 * layout containers (`div`, `listitem`, `tbody`, `scrollable`, ...) that cannot
 * be clicked or filled, most `StaticText` lines are single-token fragments
 * whose content already appears in an ancestor's accessible name, and
 * indentation grows without bound with nesting depth.
 *
 * Keeping only semantic/actionable nodes and re-indenting by kept ancestors
 * preserves every bracketed ID that `run` actions can use, because the facade
 * stores the full xpath map regardless of what is rendered here. Measured on
 * real pages, the compact tree is 21-34% of the raw tree.
 */

/** Roles worth keeping: everything a caller can act on or navigate by. */
export const SEMANTIC_SNAPSHOT_ROLES: ReadonlySet<string> = new Set([
  "RootWebArea",
  "alert",
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "heading",
  "image",
  "img",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

/**
 * `StaticText` lines below this length are almost always one-token fragments
 * (`{`, `,`, `=`, a single word from a code block) whose text is already
 * aggregated into an ancestor's name.
 */
export const MIN_STATIC_TEXT_LENGTH = 12;

/** Names longer than this are truncated so a single node cannot dominate the tree. */
export const MAX_NAME_LENGTH = 160;

export type CompactSnapshotOptions = {
  /** Hard cap on the returned text; longer trees are cut with a marker line. */
  maxChars?: number;
};

export type SnapshotLine = {
  /** Nesting depth measured in leading whitespace characters. */
  indent: number;
  /** Bracketed snapshot ID, e.g. `1-42`. */
  id: string;
  /** Accessibility role, e.g. `button` or `scrollable, html`. */
  role: string;
  /** Accessible name, empty when the node has none. */
  name: string;
};

/**
 * Parse one accessibility tree line. Returns undefined for lines that carry no
 * node — multi-line accessible names produce bare continuation lines, which a
 * compact tree drops.
 */
export function parseSnapshotLine(line: string): SnapshotLine | undefined {
  if (!line.trim()) return undefined;
  const match = /^(\s*)\[([^\]]+)\]\s?(.*)$/u.exec(line);
  if (!match) return undefined;
  const indent = match[1] ?? "";
  const id = match[2] ?? "";
  const body = match[3] ?? "";
  const separator = body.indexOf(": ");
  const role = separator === -1 ? body : body.slice(0, separator);
  const name = separator === -1 ? "" : body.slice(separator + 2);
  return { indent: indent.length, id, role, name };
}

export function isKeptSnapshotLine(line: SnapshotLine): boolean {
  if (SEMANTIC_SNAPSHOT_ROLES.has(line.role)) return true;
  return line.role === "StaticText" && line.name.trim().length >= MIN_STATIC_TEXT_LENGTH;
}

/**
 * Reduce a formatted accessibility tree to the nodes a caller can act on.
 *
 * Kept lines are re-indented by their kept ancestors, so two spaces per level
 * after filtering. Node IDs are copied verbatim: this only removes lines, never
 * rewrites a node, so IDs stay valid for `run` actions.
 */
export function compactSnapshotTree(tree: string, options: CompactSnapshotOptions = {}): string {
  const out: string[] = [];
  const ancestorIndents: number[] = [];
  for (const line of tree.split("\n")) {
    const parsed = parseSnapshotLine(line);
    if (!parsed || !isKeptSnapshotLine(parsed)) continue;
    const name =
      parsed.name.length > MAX_NAME_LENGTH
        ? `${parsed.name.slice(0, MAX_NAME_LENGTH)}…`
        : parsed.name;
    for (;;) {
      const top = ancestorIndents[ancestorIndents.length - 1];
      if (top === undefined || top < parsed.indent) break;
      ancestorIndents.pop();
    }
    const prefix = "  ".repeat(ancestorIndents.length);
    ancestorIndents.push(parsed.indent);
    out.push(`${prefix}[${parsed.id}] ${parsed.role}${name ? `: ${name}` : ""}`);
  }

  let text = out.join("\n");
  const { maxChars } = options;
  if (maxChars !== undefined && text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… [compact snapshot truncated at ${maxChars} chars]`;
  }
  return text;
}
