/**
 * Parses the hybrid snapshot outline back into nodes so the Decisions act pipeline
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

const LINE = /^( *)\[([^\]]+)\] (.*)$/;

const FLAGS = /((?: \[(?:selected|checked)\])+)$/;

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
