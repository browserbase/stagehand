import { ActionSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { Action, ActResult, ObserveResult } from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod";
import type { Page } from "./page.js";
import type { Stagehand } from "./stagehand.js";

/**
 * Minimum Jaccard similarity between two snapshot fingerprints for a page to
 * count as a known state. A page matching more than one node is ambiguous and
 * never drives replay.
 */
export const STATE_MATCH_THRESHOLD = 0.95;

const NavigationNodeSchema = z.strictObject({
  id: z.string(),
  url: z.string(),
  fingerprint: z.array(z.string()),
  frontier: z.array(ActionSchema),
});

const NavigationEdgeSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  actions: z.array(ActionSchema).min(1),
});

const NavigationGraphSchema = z.strictObject({
  nodes: z.array(NavigationNodeSchema),
  edges: z.array(NavigationEdgeSchema),
});

export type NavigationNode = z.infer<typeof NavigationNodeSchema>;
export type NavigationEdge = z.infer<typeof NavigationEdgeSchema>;
export type NavigationGraph = z.infer<typeof NavigationGraphSchema>;

export type StateRecognition =
  | { status: "matched"; nodeId: string }
  | { status: "unknown" }
  | { status: "ambiguous"; nodeIds: string[] };

export type ReplayResult =
  | { status: "completed" }
  | { status: "diverged"; step: number; expectedNodeId: string; actual: StateRecognition }
  | { status: "failed"; step: number; message: string };

type StateObservation = Pick<NavigationNode, "url" | "fingerprint">;

export function create(): NavigationGraph {
  return { nodes: [], edges: [] };
}

export function toJSON(graph: NavigationGraph): string {
  return JSON.stringify(graph);
}

export function fromJSON(json: string): NavigationGraph {
  return NavigationGraphSchema.parse(JSON.parse(json));
}

export function frontier(graph: NavigationGraph, nodeId: string): readonly Action[] {
  return getNode(graph, nodeId).frontier;
}

export async function recognize(graph: NavigationGraph, page: Page): Promise<StateRecognition> {
  return matchState(graph, await observeState(page));
}

/** Recognizes the current page, adding it as a new node when it is unknown. */
export async function recordState(graph: NavigationGraph, page: Page): Promise<StateRecognition> {
  const state = await observeState(page);
  const recognition = matchState(graph, state);
  if (recognition.status !== "unknown") return recognition;
  const node = { id: `node-${graph.nodes.length}`, ...state, frontier: [] };
  graph.nodes.push(node);
  return { status: "matched", nodeId: node.id };
}

/** Records a successful `act()` as an edge from `from` to the state the page reached. */
export async function recordAct(
  graph: NavigationGraph,
  { page, from, result }: { page: Page; from: string; result: ActResult },
): Promise<StateRecognition> {
  const source = getNode(graph, from);
  if (!result.data.success || result.data.actions.length === 0) return recognize(graph, page);
  const target = await recordState(graph, page);
  if (target.status !== "matched") return target;
  const edge = { from, to: target.nodeId, actions: result.data.actions };
  if (!graph.edges.some((known) => sameEdge(known, edge))) graph.edges.push(edge);
  const tried = new Set(edge.actions.map(actionKey));
  source.frontier = source.frontier.filter((action) => !tried.has(actionKey(action)));
  return target;
}

/** Adds observed actions that are neither in the frontier nor already tried from `nodeId`. */
export function recordObserve(
  graph: NavigationGraph,
  { nodeId, result }: { nodeId: string; result: ObserveResult },
): void {
  const node = getNode(graph, nodeId);
  const known = new Set(
    graph.edges
      .filter((edge) => edge.from === nodeId)
      .flatMap((edge) => edge.actions)
      .concat(node.frontier)
      .map(actionKey),
  );
  for (const action of result.data) {
    if (known.has(actionKey(action))) continue;
    known.add(actionKey(action));
    node.frontier.push(action);
  }
}

/** Shortest path by edge count (BFS), or `undefined` when `to` is unreachable. */
export function findPath(
  graph: NavigationGraph,
  from: string,
  to: string,
): NavigationEdge[] | undefined {
  const reachedBy = new Map<string, NavigationEdge | undefined>([[from, undefined]]);
  const queue = [from];
  for (const nodeId of queue) {
    if (nodeId === to) return unwindPath(reachedBy, to);
    for (const edge of graph.edges) {
      if (edge.from !== nodeId || reachedBy.has(edge.to)) continue;
      reachedBy.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return undefined;
}

/** Replays `path` through `act(action)` only, stopping as soon as the page leaves it. */
export async function replay(
  graph: NavigationGraph,
  {
    stagehand,
    page,
    path,
  }: { stagehand: Pick<Stagehand, "act">; page: Page; path: NavigationEdge[] },
): Promise<ReplayResult> {
  for (const [step, edge] of path.entries()) {
    const divergence = await checkState(graph, page, { step, expectedNodeId: edge.from });
    if (divergence) return divergence;
    for (const action of edge.actions) {
      const result = await stagehand.act(action, { page });
      if (!result.data.success) return { status: "failed", step, message: result.data.message };
    }
  }
  const last = path.at(-1);
  if (!last) return { status: "completed" };
  const divergence = await checkState(graph, page, { step: path.length, expectedNodeId: last.to });
  return divergence ?? { status: "completed" };
}

async function checkState(
  graph: NavigationGraph,
  page: Page,
  { step, expectedNodeId }: { step: number; expectedNodeId: string },
): Promise<ReplayResult | undefined> {
  const actual = await recognize(graph, page);
  if (actual.status === "matched" && actual.nodeId === expectedNodeId) return undefined;
  return { status: "diverged", step, expectedNodeId, actual };
}

async function observeState(page: Page): Promise<StateObservation> {
  const url = normalizeUrl(await page.url());
  const { formattedTree } = await page.snapshot();
  return { url, fingerprint: fingerprint(formattedTree) };
}

function matchState(graph: NavigationGraph, state: StateObservation): StateRecognition {
  const nodeIds = graph.nodes
    .filter((node) => node.url === state.url)
    .filter((node) => similarity(node.fingerprint, state.fingerprint) >= STATE_MATCH_THRESHOLD)
    .map((node) => node.id);
  const [nodeId, ...others] = nodeIds;
  if (nodeId === undefined) return { status: "unknown" };
  if (others.length > 0) return { status: "ambiguous", nodeIds };
  return { status: "matched", nodeId };
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.searchParams.sort();
  return url.href;
}

/** Snapshot lines without their per-load element ids, deduplicated and sorted. */
function fingerprint(formattedTree: string): string[] {
  const lines = formattedTree.split("\n").map((line) => line.replace(/^\s*\[[^\]]*\]/, "").trim());
  return [...new Set(lines.filter(Boolean))].sort();
}

function similarity(known: string[], current: string[]): number {
  const knownLines = new Set(known);
  const shared = current.filter((line) => knownLines.has(line)).length;
  const union = knownLines.size + current.length - shared;
  return union === 0 ? 1 : shared / union;
}

function unwindPath(
  reachedBy: Map<string, NavigationEdge | undefined>,
  to: string,
): NavigationEdge[] {
  const path: NavigationEdge[] = [];
  for (let edge = reachedBy.get(to); edge; edge = reachedBy.get(edge.from)) path.unshift(edge);
  return path;
}

function sameEdge(a: NavigationEdge, b: NavigationEdge): boolean {
  return a.from === b.from && a.to === b.to && actionsKey(a.actions) === actionsKey(b.actions);
}

function actionsKey(actions: Action[]): string {
  return JSON.stringify(actions.map(actionKey));
}

function actionKey(action: Action): string {
  return JSON.stringify([action.selector, action.method, action.arguments]);
}

function getNode(graph: NavigationGraph, nodeId: string): NavigationNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown navigation graph node: ${nodeId}`);
  return node;
}
