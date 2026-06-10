/**
 * Foundation for the Yutori Navigator n1.5 *expanded* tool set.
 *
 * Design: Stagehand's native accessibility snapshot is the source of truth
 * (deterministic per page state). We render it in Navigator's `extract_elements`
 * text format and keep a `ref_N -> { encodedId, xpath }` map so the model sees
 * the format it was trained on, while we resolve refs back to Stagehand's robust
 * `xpath -> deepLocator` path for `set_element_value` and friends.
 *
 * This module is pure (snapshot in, text/refs out) and has no page access —
 * wiring (snapshot capture, deepLocator fill, evaluate, tool dispatch) is
 * layered on top separately.
 *
 * @see https://docs.yutori.com/reference/n1-5.md
 */

import type { HybridSnapshot } from "../../types/private/snapshot.js";

const MAX_NAME_LENGTH = 100; // Navigator truncates element names at 100 chars.

/** A resolved element reference: where the element is in the a11y tree + DOM. */
export interface NavigatorRef {
  encodedId: string;
  xpath?: string;
}

/**
 * Bi-directional map between Navigator `ref_N` tokens and Stagehand a11y
 * `encodedId`s (+ the element's xpath). Stable within a run: the same element
 * (encodedId) always maps to the same ref, so refs minted by
 * `extract_elements`/`find` stay resolvable on later turns while the element
 * exists (mirrors Navigator's own WeakRef store semantics).
 */
export class NavigatorRefRegistry {
  private readonly refByEncoded = new Map<string, string>();
  private readonly entryByRef = new Map<string, NavigatorRef>();
  private counter = 0;

  /** Get the existing ref for an encodedId, or mint a new stable one. */
  refFor(encodedId: string, xpath?: string): string {
    const existing = this.refByEncoded.get(encodedId);
    if (existing) {
      // Refresh the xpath if a newer snapshot supplied one.
      if (xpath) this.entryByRef.get(existing)!.xpath = xpath;
      return existing;
    }
    const ref = `ref_${++this.counter}`;
    this.refByEncoded.set(encodedId, ref);
    this.entryByRef.set(ref, { encodedId, xpath });
    return ref;
  }

  /** Resolve a `ref_N` back to its element entry, or undefined if unknown. */
  resolve(ref: string): NavigatorRef | undefined {
    return this.entryByRef.get(ref);
  }

  /** Clear all mappings (e.g. on a new agent run). */
  reset(): void {
    this.refByEncoded.clear();
    this.entryByRef.clear();
    this.counter = 0;
  }
}

/** One parsed line of Stagehand's combined a11y outline. */
interface ParsedOutlineLine {
  indent: string;
  encodedId: string;
  role: string;
  name?: string;
}

// `{indent}[encodedId] role: name [flags]` — see understudy/a11y treeFormatUtils.
const OUTLINE_LINE = /^(\s*)\[([^\]]+)\]\s+(.*)$/;
const TRAILING_STATE_FLAGS = /(?:\s\[(?:selected|checked)\])+$/;

function parseOutlineLine(raw: string): ParsedOutlineLine | null {
  const m = OUTLINE_LINE.exec(raw);
  if (!m) return null;
  const [, indent, encodedId, restRaw] = m;
  const rest = restRaw.replace(TRAILING_STATE_FLAGS, "");
  const colon = rest.indexOf(": ");
  // Role never contains ": " (it's an ARIA role token); everything after the
  // first ": " is the (possibly colon-containing) accessible name.
  const role = colon === -1 ? rest.trim() : rest.slice(0, colon).trim();
  const name = colon === -1 ? undefined : rest.slice(colon + 2).trim();
  if (!role) return null;
  return { indent, encodedId, role, name: name || undefined };
}

function quoteName(name: string): string {
  return name.slice(0, MAX_NAME_LENGTH).replace(/"/g, '\\"');
}

type RenderableSnapshot = Pick<
  HybridSnapshot,
  "combinedTree" | "combinedUrlMap" | "combinedXpathMap"
>;

/** Build the Navigator-format line for a parsed outline node and register its ref. */
function renderLine(
  parsed: ParsedOutlineLine,
  snapshot: RenderableSnapshot,
  registry: NavigatorRefRegistry,
): string {
  const ref = registry.refFor(
    parsed.encodedId,
    snapshot.combinedXpathMap[parsed.encodedId],
  );
  let line = `${parsed.indent}- ${parsed.role}`;
  if (parsed.name) line += ` "${quoteName(parsed.name)}"`;
  line += ` [ref=${ref}]`;
  const href = snapshot.combinedUrlMap[parsed.encodedId];
  if (href) line += ` href="${href.replace(/"/g, '\\"')}"`;
  return line;
}

/** A structural-only generic node (no accessible name) — dropped, as the reference tool does. */
function isStructuralNoise(parsed: ParsedOutlineLine): boolean {
  return parsed.role === "generic" && !parsed.name;
}

/**
 * Render Stagehand's hybrid a11y snapshot into Navigator's `extract_elements`
 * text format, minting/looking up `ref_N` tokens via `registry`:
 *
 *   `{indent}- {role} "{name}" [ref=ref_N] href="..."`
 *
 * (`id`/`type`/`placeholder` aren't present in the accessibility data; surfacing
 * them is a follow-up enrichment.)
 */
export function renderExpandedSnapshot(
  snapshot: RenderableSnapshot,
  registry: NavigatorRefRegistry,
): string {
  const lines: string[] = [];
  for (const raw of snapshot.combinedTree.split("\n")) {
    const parsed = parseOutlineLine(raw);
    if (!parsed || isStructuralNoise(parsed)) continue;
    lines.push(renderLine(parsed, snapshot, registry));
  }
  return lines.join("\n");
}

/**
 * Navigator's `find`: return the rendered lines whose role/name contains the
 * query (case-insensitive), each with a registered `ref_N`. Mints refs into the
 * same registry so they stay consistent with `extract_elements`.
 */
export function findInSnapshot(
  snapshot: RenderableSnapshot,
  registry: NavigatorRefRegistry,
  query: string,
  limit = 20,
): { matches: string[]; total: number } {
  const needle = query.trim().toLowerCase();
  const matches: string[] = [];
  let total = 0;
  for (const raw of snapshot.combinedTree.split("\n")) {
    const parsed = parseOutlineLine(raw);
    if (!parsed || isStructuralNoise(parsed)) continue;
    const haystack = `${parsed.role} ${parsed.name ?? ""}`.toLowerCase();
    if (!needle || haystack.includes(needle)) {
      total += 1;
      if (matches.length < limit) {
        matches.push(renderLine(parsed, snapshot, registry).trimStart());
      }
    }
  }
  return { matches, total };
}
