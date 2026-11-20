import type { DataView } from "../dataView.js";
import type { OutlineNode } from "../outline.js";
import { firstLeaf } from "./outlineIndex.js";

/** Slot-key segment for the first item of a list inside a cell. */
export const FIRST_ITEM = "~first";

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Read the mapped slot exactly. An ancestor can contain unrelated field values. */
export function readSlot(
  view: Pick<DataView, "runs" | "followers" | "nodes" | "children">,
  record: OutlineNode,
  key: string,
): OutlineNode | undefined {
  if (key.endsWith(`/${FIRST_ITEM}`)) {
    const cell = readSlot(view, record, key.slice(0, -FIRST_ITEM.length - 1));
    return cell && firstLeaf(view.nodes, cell);
  }
  const follower = /^\+(\d+)(?:\/(.*))?$/.exec(key);
  if (follower) {
    const row = view.followers.get(record.index)?.[Number(follower[1]) - 1];
    return row ? readSlot(view, row, follower[2] || ".") : undefined;
  }
  const segments = key === "." ? [] : key.split("/");
  let current: OutlineNode | undefined = record;
  for (const segment of segments) {
    const match = /^(.+)\[(\d+)\]$/.exec(segment);
    if (!match || !current) return undefined;
    const [, role, ordinal] = match;
    const kids = view.children[current.index]!.map((i) => view.nodes[i]!).filter(
      (n) => n.role.toLowerCase() === role,
    );
    current = kids[Number(ordinal) - 1];
  }
  if (!current) return undefined;
  const run = !current.name.trim() ? view.runs.get(current.index) : undefined;
  return run ? { ...current, name: run } : current.name.trim() ? current : undefined;
}

export function recordText(
  view: Pick<DataView, "nodes" | "followers">,
  record: OutlineNode,
  max = 160,
): string {
  const parts: string[] = [];
  for (let i = record.index; i < view.nodes.length; i++) {
    const node = view.nodes[i]!;
    if (i > record.index && node.depth <= record.depth) break;
    if (node.name.trim() && !parts.some((part) => part.includes(node.name)))
      parts.push(node.name.trim());
  }
  const rest = (view.followers.get(record.index) ?? []).map((row) => recordText(view, row, max));
  return clip([parts.join(" | "), ...rest].join(" | "), max);
}
