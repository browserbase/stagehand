import type { A11yNode } from "../../../types/private/snapshot.js";

/**
 * Render a formatted outline (with encoded ids) for the accessibility tree.
 * Keeps indentation logic shared between modules so unit tests can cover these
 * pure formatting helpers without a full snapshot pipeline.
 */
export function formatTreeLine(node: A11yNode, level = 0): string {
  const indent = "  ".repeat(level);
  const labelId = node.encodedId ?? node.nodeId;
  const label = `[${labelId}] ${node.role}${node.name ? `: ${cleanText(node.name)}` : ""}`;
  const kids =
    node.children?.map((c) => formatTreeLine(c, level + 1)).join("\n") ?? "";
  return kids ? `${indent}${label}\n${kids}` : `${indent}${label}`;
}

/**
 * Inject each child frame outline under the parent's iframe node line.
 * Keys in `idToTree` are the parent's iframe encoded ids.
 */
export function injectSubtrees(
  rootOutline: string,
  idToTree: Map<string, string>,
): string {
  type Frame = { lines: string[]; i: number };
  const out: string[] = [];
  const visited = new Set<string>();
  const stack: Frame[] = [{ lines: rootOutline.split("\n"), i: 0 }];

  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.lines.length) {
      stack.pop();
      continue;
    }

    const raw = top.lines[top.i++];
    out.push(raw);

    const indent = raw.match(/^(\s*)/)?.[1] ?? "";
    const content = raw.slice(indent.length);

    const m = content.match(/^\[([^\]]+)]/);
    if (!m) continue;

    const encId = m[1]!;
    const childOutline = idToTree.get(encId);
    if (!childOutline || visited.has(encId)) continue;

    visited.add(encId);

    const fullyInjectedChild = injectSubtrees(childOutline, idToTree);
    out.push(indentBlock(fullyInjectedChild.trimEnd(), indent + "  "));
  }

  return out.join("\n");
}

export function indentBlock(block: string, indent: string): string {
  if (!block) return "";
  return block
    .split("\n")
    .map((line) => (line.length ? indent + line : indent + line))
    .join("\n");
}

/**
 * Return the lines that appear in `nextTree` but not in `prevTree`.
 * Comparison is done line-by-line, ignoring leading whitespace in both trees.
 * The returned block is re-indented so the minimal indent becomes column 0.
 */
export function diffCombinedTrees(prevTree: string, nextTree: string): string {
  const prevSet = new Set(
    (prevTree || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );

  const nextLines = (nextTree || "").split("\n");
  const added: string[] = [];
  for (const line of nextLines) {
    const core = line.trim();
    if (!core) continue;
    if (!prevSet.has(core)) added.push(line);
  }

  if (added.length === 0) return "";

  let minIndent = Infinity;
  for (const l of added) {
    if (!l.trim()) continue;
    const m = l.match(/^\s*/);
    const indentLen = m ? m[0]!.length : 0;
    if (indentLen < minIndent) minIndent = indentLen;
  }
  if (!isFinite(minIndent)) minIndent = 0;

  const out = added.map((l) =>
    l.length >= minIndent ? l.slice(minIndent) : l,
  );
  return out.join("\n");
}

/**
 * Remove whitespace noise and invisible code points before rendering names.
 */
export function cleanText(input: string): string {
  const PUA_START = 0xe000;
  const PUA_END = 0xf8ff;
  const NBSP = new Set<number>([0x00a0, 0x202f, 0x2007, 0xfeff]);

  let out = "";
  let prevSpace = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= PUA_START && code <= PUA_END) continue;
    if (NBSP.has(code)) {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
      continue;
    }
    out += input[i];
    prevSpace = input[i] === " ";
  }
  return out.trim();
}

/**
 * Collapse all whitespace runs in a string to a single space without trimming.
 * Exported for pruning routines that need the same normalization.
 */
export function normaliseSpaces(s: string): string {
  let out = "";
  let inWs = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      out += ch;
      inWs = false;
    }
  }
  return out;
}
