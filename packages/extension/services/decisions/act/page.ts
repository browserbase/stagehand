import { trimTrailingTextNode } from "../../../utils.js";
import type { Snapshot, TraceEntry } from "../pick.js";
import { markEditable, type OutlineNode, parseOutline } from "../tree.js";
import type { DecisionsActDeps } from "./types.js";

/**
 * Reading the page for the pipeline: snapshots, selectors, and how a node is shown in traces.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function snapshot(deps: DecisionsActDeps): Promise<Snapshot> {
  await deps.settled;
  return await capture(deps);
}

export async function capture(deps: DecisionsActDeps, trace?: TraceEntry[]): Promise<Snapshot> {
  deps.ensureTimeRemaining();
  const startedAt = performance.now();
  const { combinedTree, combinedXpathMap, combinedEditableIds } = await deps.page.captureSnapshot(
    deps.snapshotOptions,
  );
  const nodes = parseOutline(combinedTree);
  markEditable(nodes, combinedEditableIds);
  // On heavy, still-loading pages this is seconds; the trace makes that visible.
  trace?.push({
    node: "snapshot",
    ms: Math.round(performance.now() - startedAt),
    lines: nodes.length,
  });
  return { tree: combinedTree, xpathMap: combinedXpathMap as Record<string, string>, nodes };
}

/** Query strings and fragments carry tokens; page-state questions only need where we are. */
export function withoutQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

export function selectorFor(snap: Snapshot, node: OutlineNode): string | undefined {
  const xpath = trimTrailingTextNode(snap.xpathMap[node.id]);
  return xpath ? `xpath=${xpath}` : undefined;
}

export function describeLine(node: OutlineNode): string {
  return node.name ? `${node.role}: ${node.name}` : node.role;
}
