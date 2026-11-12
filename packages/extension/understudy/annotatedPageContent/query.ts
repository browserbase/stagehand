import type { Page } from "../page.js";
import type { Progress } from "../progress.js";
import type { AnnotatedPageContent } from "./index.js";
import type { ContentNodeJson } from "./common_quality_data_pb.js";
import type { ApcAction } from "./actions.js";
import { filterAnnotatedPageContent, type ApcNode } from "./filter.js";
import { resolveAnnotatedPageContentTargets, type ApcTarget } from "./targets.js";
import { scopeAnnotatedPageContent, type ApcScope } from "./scopes.js";

export type ApcQueryOptions = {
  actions?: readonly ApcAction[];
  /** Omitted means the whole capture; an empty list matches nothing. */
  scopes?: readonly ApcScope[];
};

export type ApcQueryNode = ApcNode & { id?: string };

export type ApcQueryResult = {
  /** Retained nodes in document order, including context and unresolved nodes. */
  nodes: readonly ApcQueryNode[];
  /** Resolved identities for retained nodes; eligibility is recorded on each node. */
  targetsById: ReadonlyMap<string, ApcTarget>;
  filtered: boolean;
};

/** Capture once so the filtered content and executable identities describe the same nodes. */
export async function queryAnnotatedPageContent(
  page: Page,
  options: ApcQueryOptions,
  progress: Progress,
): Promise<ApcQueryResult> {
  const content = await page.captureAnnotatedPageContent(progress);
  const targets = await resolveAnnotatedPageContentTargets(page, content, progress);
  const query = prepareAnnotatedPageContentQuery(content, options.actions, progress, targets);
  return options.scopes === undefined
    ? query
    : scopeAnnotatedPageContent(page, query, options.scopes, progress);
}

/** Join the filtered tree to identities resolved from this same capture. */
export function prepareAnnotatedPageContentQuery(
  content: AnnotatedPageContent,
  actions: readonly ApcAction[] = [],
  progress?: Progress,
  targets: ReadonlyMap<ContentNodeJson, ApcTarget> = new Map(),
): ApcQueryResult {
  const nodes: ApcQueryNode[] = [];
  const targetsById = new Map<string, ApcTarget>();
  for (const node of filterAnnotatedPageContent(content, actions, progress)) {
    progress?.throwIfStopped();
    const target = targets.get(node.source);
    nodes.push(target ? { ...node, id: target.id } : node);
    if (target) targetsById.set(target.id, target);
  }
  progress?.throwIfStopped();
  return { nodes, targetsById, filtered: actions.length > 0 };
}
