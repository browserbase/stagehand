import type { JsonValue } from "../client.js";
import { type OutlineNode, textOf } from "../tree.js";
import type { Leaf } from "./plan.js";
import type { DecisionsExtractDeps, Item } from "./types.js";

/** Copying a value off a node: text, numbers, URLs, and the small tree helpers that needs. */

/** Equal, or numbers within 2% ("250.5k" in the sidebar, "251k" in the header). */
export function sameValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function childrenOf(nodes: OutlineNode[], parent: OutlineNode): OutlineNode[] {
  const children: OutlineNode[] = [];
  for (let i = parent.index + 1; i < nodes.length && nodes[i]!.depth > parent.depth; i++) {
    if (nodes[i]!.parent === parent.index) children.push(nodes[i]!);
  }
  return children;
}

export function descendantsOf(nodes: OutlineNode[], root: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let i = root.index + 1; i < nodes.length && nodes[i]!.depth > root.depth; i++)
    out.push(nodes[i]!);
  return out;
}

export function itemText(nodes: OutlineNode[], item: Item | undefined): string {
  return (item ?? [])
    .map((node) => textOf(nodes, node))
    .filter(Boolean)
    .join(" · ");
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function valueOf(
  deps: DecisionsExtractDeps,
  leaf: Leaf,
  node: OutlineNode,
): JsonValue | undefined {
  if (leaf.kind === "url") {
    const direct = deps.urlMap[node.id];
    if (direct) return direct;
    // The picked text may sit inside the link.
    for (let at = node.parent; at !== undefined; at = deps.snap.nodes[at]!.parent) {
      const url = deps.urlMap[deps.snap.nodes[at]!.id];
      if (url) return url;
    }
    return undefined;
  }
  const text = stripLabel(textOf(deps.snap.nodes, node), leaf);
  if (!text) return undefined;
  if (leaf.kind === "string") return text;
  const number = parseNumberText(text);
  if (number === undefined) return undefined;
  // An integer field whose text is fractional is the wrong element, not a
  // value to round into the schema.
  if (leaf.kind === "integer") return Number.isInteger(number) ? number : undefined;
  return number;
}

/**
 * "1,249.50" → 1249.5, "1.2k stars" → 1200, "3M views" → 3e6, "2 km" → 2.
 * Whitespace is collapsed, not removed: a unit word after the suffix must not
 * swallow the suffix, and a space between number and letter is not a suffix.
 */
export function parseNumberText(text: string): number | undefined {
  const match = /(-?\d[\d,]*(?:\.\d+)?)([kKmMbB])?(?![\w])/.exec(text.replace(/\s+/g, " "));
  if (!match) return undefined;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const number = Number(match[1]!.replace(/,/g, "")) * scale;
  return Number.isFinite(number) ? number : undefined;
}

/** "Price: $20" picked for the field `price` → "$20". */
function stripLabel(text: string, leaf: Leaf): string {
  const match = /^([^:]{1,40}):\s+(.+)$/s.exec(text.trim());
  if (!match) return text.trim();
  const words = new Set(
    `${leaf.path.join(" ")} ${leaf.description}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  const label = match[1]!.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return label.some((word) => words.has(word)) ? match[2]!.trim() : text.trim();
}

export function requestedCount(instruction: string): number | undefined {
  const match = /\b(?:top|first)\s+(\d{1,3})\b/i.exec(instruction);
  return match ? Number(match[1]) : undefined;
}

export function setPath(target: Record<string, JsonValue>, path: string[], value: JsonValue): void {
  let at = target;
  for (const key of path.slice(0, -1)) {
    if (typeof at[key] !== "object" || at[key] === null || Array.isArray(at[key])) at[key] = {};
    at = at[key] as Record<string, JsonValue>;
  }
  at[path[path.length - 1]!] = value;
}

/** Lists longer than a few items are shown to the completion judge as count + first items. */
export function compactForJudge(value: JsonValue, limit = 6000): JsonValue {
  if ((JSON.stringify(value) ?? "").length <= limit) return value;
  const compact = (item: JsonValue): JsonValue => {
    if (Array.isArray(item)) {
      return item.length <= 3
        ? item.map(compact)
        : { item_count: item.length, first_items: item.slice(0, 3).map(compact) };
    }
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, compact(child)]));
    }
    return typeof item === "string" && item.length > 200 ? `${item.slice(0, 200)}…` : item;
  };
  return compact(value);
}
