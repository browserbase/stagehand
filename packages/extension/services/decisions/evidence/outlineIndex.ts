import { parseOutline, type OutlineNode } from "../outline.js";

export type OutlineIndex = ReturnType<typeof indexOutline>;

export const INLINE_ROLES = new Set([
  "statictext",
  "linebreak",
  "strong",
  "emphasis",
  "abbr",
  "time",
  "superscript",
  "subscript",
  "mark",
  "link",
  "listmarker",
]);
const SKIP_ROLES = new Set(["rootwebarea", "scrollable, html", "html", "linebreak", "listmarker"]);
export const lower = (node: OutlineNode) => node.role.toLowerCase();
export const named = (node: OutlineNode) =>
  node.name.trim().length > 0 && !SKIP_ROLES.has(lower(node));

function subtree(nodes: OutlineNode[], root: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let i = root.index + 1; i < nodes.length && nodes[i]!.depth > root.depth; i++)
    out.push(nodes[i]!);
  return out;
}

/** The first named leaf under `root`, or `root` itself when it has none. */
export function firstLeaf(nodes: OutlineNode[], root: OutlineNode): OutlineNode {
  return (
    subtree(nodes, root).find((node) => named(node) && !subtree(nodes, node).some(named)) ?? root
  );
}

// Chrome splits a scientific literal at <sup>. Flattened text alone cannot
// distinguish a positive exponent ("103") from the integer one hundred three.
function scientificNotation(
  nodes: OutlineNode[],
  children: number[][],
  inlineText: (node: OutlineNode, max: number) => string | undefined,
): Map<number, OutlineNode> {
  const numericNodes = new Map<number, OutlineNode>();
  for (const parent of nodes) {
    const siblings = children[parent.index]!;
    if (!siblings.some((i) => lower(nodes[i]!) === "superscript")) continue;
    const text = parent.name || inlineText(parent, 1500);
    if (!text) continue;
    const pieces = subtree(nodes, parent);
    const following = nodes[parent.index + pieces.length + 1];
    const note =
      following && following.parent === parent.parent
        ? following.name || firstLeaf(nodes, following).name
        : "";

    // Verify the complete accessible name against its children. Joining the
    // projected pieces with spaces keeps an adjacent unit or note out of the exponent.
    const projected: string[] = [];
    const consumed: OutlineNode[] = [];
    let remaining = text;
    for (const piece of pieces) {
      if (!named(piece)) continue;
      remaining = remaining.trimStart();
      if (!remaining.startsWith(piece.name)) {
        remaining = text;
        break;
      }
      remaining = remaining.slice(piece.name.length);
      projected.push(piece.name);

      const exponent = nodes[piece.index - 1];
      const prefix = nodes[piece.index - 2];
      if (
        !exponent ||
        !prefix ||
        lower(exponent) !== "superscript" ||
        exponent.name ||
        exponent.parent !== parent.index ||
        prefix.parent !== parent.index ||
        piece.parent !== exponent.index ||
        children[exponent.index]!.length !== 1 ||
        lower(prefix) !== "statictext" ||
        lower(piece) !== "statictext" ||
        !/^[+−-]?\d+$/.test(piece.name)
      )
        continue;
      // A following numbered note can identify an anonymous <sup> in 2 × 10[3].
      if (note.startsWith(piece.name + ". ") || note.startsWith(piece.name + ") ")) continue;
      const match =
        /^((?:to\s+|[–—]\s*)?)([+−-]?(?:\d+(?:\.(?:\d+|(?:\d{3} )+\d{1,4}))?|\.\d+))\s*[×x]\s*10$/iu.exec(
          prefix.name,
        );
      if (!match) continue;
      const literal = (match[2]!.replaceAll(" ", "") + "e" + piece.name).replaceAll("−", "-");
      projected.splice(-2, 2, match[1] + literal);
      consumed.push(prefix, piece);
    }
    if (!consumed.length || remaining) continue;
    numericNodes.set(parent.index, { ...parent, name: projected.join(" ") });
    for (const part of consumed) numericNodes.set(part.index, { ...part, name: "" });
  }
  return numericNodes;
}

export function indexOutline(tree: string) {
  const nodes = parseOutline(tree);
  const children: number[][] = nodes.map(() => []);
  for (const node of nodes) if (node.parent !== undefined) children[node.parent]!.push(node.index);

  /** Text of an unnamed node made only of inline pieces ("2", "tablespoons", "olive oil"). */
  const inlineText = (node: OutlineNode, max = 400): string | undefined => {
    if (node.name.trim()) return undefined;
    const kids = descendants(node);
    const pieces = kids.filter((kid) => named(kid) && lower(kid) !== "listmarker");
    if (pieces.length < 2 || !kids.every((kid) => INLINE_ROLES.has(lower(kid)))) return undefined;
    const direct = new Set(children[node.index]);
    const text = pieces
      .filter((kid) => direct.has(kid.index) || lower(nodes[kid.parent!]!) !== "link")
      .map((kid) => kid.name.trim())
      .join(" ")
      .replace(/\s+([,.;:)])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return text.length <= max ? text : undefined;
  };

  const descendants = (root: OutlineNode): OutlineNode[] => subtree(nodes, root);
  const numericNodes = scientificNotation(nodes, children, inlineText);
  const headingBefore = (node: OutlineNode, lowerBound = 0): string => {
    for (let i = node.index - 1; i >= lowerBound; i--) {
      const candidate = nodes[i]!;
      if (lower(candidate) === "heading" && candidate.name && candidate.depth <= node.depth + 2)
        return candidate.name;
      if (/^table$/.test(lower(candidate)) && candidate.name) return candidate.name;
    }
    return "";
  };

  const textOf = (node: OutlineNode): string =>
    node.name ||
    descendants(node)
      .filter(named)
      .map((d) => d.name)
      .join(" ");

  const tableHeader = (record: OutlineNode): Map<string, string> => {
    const labels = new Map<string, string>();
    if (lower(record) !== "row") return labels;
    let table: OutlineNode | undefined = record;
    while (table && !/table|grid/.test(lower(table)))
      table = table.parent === undefined ? undefined : nodes[table.parent];
    if (!table) return labels;
    const rows = descendants(table).filter((node) => lower(node) === "row");
    let headerRow: OutlineNode | undefined;
    for (const row of rows) {
      const cells = children[row.index]!.map((i) => nodes[i]!);
      const isHeader =
        cells.some((cell) => lower(cell) === "columnheader" && cell.name) ||
        (row === rows[0] &&
          cells.length > 1 &&
          cells.some((cell) => textOf(cell).trim()) &&
          cells
            .filter((cell) => textOf(cell).trim())
            .every((cell) => descendants(cell).some((d) => lower(d) === "strong")));
      if (!isHeader) break;
      headerRow = row;
    }
    if (!headerRow) return labels;
    let ordinal = 0;
    for (const i of children[headerRow.index]!) {
      const cell = nodes[i]!;
      if (/cell|columnheader|rowheader/.test(lower(cell)))
        labels.set(`pos${++ordinal}`, cell.name || textOf(cell));
    }
    return labels;
  };

  const inside = (outer: OutlineNode, inner: OutlineNode) =>
    inner.index > outer.index &&
    nodes.slice(outer.index + 1, inner.index + 1).every((n) => n.depth > outer.depth);

  /** Path of role[ordinal] segments from `root` to `node`. */
  const slotKey = (root: OutlineNode, node: OutlineNode): string => {
    const segments: string[] = [];
    let current = node;
    while (current.index !== root.index) {
      const parent = nodes[current.parent!]!;
      const ordinal =
        children[parent.index]!.filter((i) => lower(nodes[i]!) === lower(current)).indexOf(
          current.index,
        ) + 1;
      segments.unshift(`${lower(current)}[${ordinal}]`);
      current = parent;
    }
    return segments.join("/") || ".";
  };

  const runs = new Map<number, string>();
  for (const node of nodes) {
    const run = inlineText(node);
    if (run) runs.set(node.index, run);
  }
  return {
    nodes,
    children,
    runs,
    numericNodes,
    descendants,
    inlineText,
    slotKey,
    inside,
    headingBefore,
    tableHeader,
    textOf,
  };
}
