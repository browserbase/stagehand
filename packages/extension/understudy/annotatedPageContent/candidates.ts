import type { Protocol } from "devtools-protocol";
import type { Locator } from "../locator.js";
import type { Page } from "../page.js";
import type { Progress } from "../progress.js";
import type { ApcAction } from "./actions.js";
import { isRedacted } from "./actions.js";
import { formatAnnotatedPageContentCandidate } from "./format.js";
import type { ApcQueryResult } from "./query.js";
import type { ApcScope } from "./scopes.js";
import type { ApcTarget } from "./targets.js";

/** Operation intent belongs to the caller; the model only chooses a target. */
const operationActions = {
  click: "click",
  sendClickEvent: "click",
  fill: "fill",
  type: "type",
  selectOption: "select",
  setInputFiles: "upload",
  hover: "hover",
  scrollTo: "scroll",
  count: undefined,
  isVisible: undefined,
  isChecked: undefined,
  inputValue: undefined,
  textContent: undefined,
  innerText: undefined,
  innerHtml: undefined,
  centroid: undefined,
  highlight: undefined,
} as const satisfies Partial<Record<keyof Locator, ApcAction | undefined>>;

export type ApcLocatorOperation = keyof typeof operationActions;

export function actionForLocatorOperation(operation?: ApcLocatorOperation): ApcAction | undefined {
  return operation === undefined ? undefined : operationActions[operation];
}

export type ApcCandidate = { id: string; description: string };

export type ApcCandidateResult = {
  content: string;
  candidates: readonly ApcCandidate[];
  targetsById: ReadonlyMap<string, ApcTarget>;
  /** Potential matches with no executable identity; scope membership is unknown. */
  unresolvedCount: number;
  /** Known capture gaps, even when there are no returned candidates. */
  limitations: readonly ("hidden-file-inputs" | "select-option-disabled-state")[];
};

export type ApcCandidateOptions = {
  /** Omit for an intermediate query; reads likewise have no action filter. */
  operation?: ApcLocatorOperation;
  scopes?: readonly ApcScope[];
};

export async function queryAnnotatedPageContentCandidates(
  page: Page,
  options: ApcCandidateOptions,
  progress: Progress,
): Promise<ApcCandidateResult> {
  const action = actionForLocatorOperation(options.operation);
  const query = await page.queryAnnotatedPageContent(
    {
      actions: action === undefined ? [] : [action],
      scopes: options.scopes,
    },
    progress,
  );
  const result = prepareAnnotatedPageContentCandidates(query, progress);
  const limitations: ApcCandidateResult["limitations"] =
    action === "upload"
      ? ["hidden-file-inputs"]
      : action === "select"
        ? ["select-option-disabled-state"]
        : [];
  if (action !== "upload") return { ...result, limitations };

  const redactedIds = new Set(
    query.nodes.filter((node) => isRedacted(node.source.contentAttributes)).map((node) => node.id),
  );
  const candidates: ApcCandidate[] = [];
  for (const candidate of result.candidates) {
    progress.throwIfStopped();
    const target = result.targetsById.get(candidate.id)!;
    // Never recover metadata from a redacted control.
    if (redactedIds.has(candidate.id)) {
      candidates.push(candidate);
      continue;
    }
    const { node: dom } = await progress.run("reading upload constraints", () =>
      target.frame.session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", {
        backendNodeId: target.backendNodeId,
      }),
    );
    if (dom.localName !== "input") throw new Error("APC upload target is no longer a file input");
    const attributes = new Map<string, string>();
    for (let index = 0; index < (dom.attributes?.length ?? 0); index += 2)
      attributes.set(dom.attributes![index]!, dom.attributes![index + 1]!);
    if (attributes.get("type")?.toLowerCase() !== "file")
      throw new Error("APC upload target is no longer a file input");
    const details: string[] = [];
    const accept = attributes.get("accept");
    if (accept) details.push("accept=" + JSON.stringify(accept));
    if (attributes.has("multiple")) details.push("multiple");
    candidates.push({
      ...candidate,
      description: candidate.description + (details.length ? " [" + details.join("; ") + "]" : ""),
    });
  }
  progress.throwIfStopped();
  return { ...result, candidates, content: candidateContent(candidates), limitations };
}

/** Reuse APC's descriptions and exact identities, never parse formatted output. */
export function prepareAnnotatedPageContentCandidates(
  query: ApcQueryResult,
  progress?: Progress,
): ApcCandidateResult {
  const candidates: ApcCandidate[] = [];
  const targetsById = new Map<string, ApcTarget>();
  const seen = new Set<string>();
  for (const node of query.nodes) {
    progress?.throwIfStopped();
    if (query.filtered && !node.target) continue;
    const target = node.id === undefined ? undefined : query.targetsById.get(node.id);
    if (!target) continue;
    const identity = target.frame.frameId + ":" + target.backendNodeId;
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push({
      id: target.id,
      description: formatAnnotatedPageContentCandidate(node, progress),
    });
    targetsById.set(target.id, target);
  }
  progress?.throwIfStopped();
  return {
    content: candidateContent(candidates),
    candidates,
    targetsById,
    unresolvedCount: query.unresolvedCount,
    limitations: [],
  };
}

function candidateContent(candidates: readonly ApcCandidate[]): string {
  return candidates
    .map((candidate) => "[" + candidate.id + "] " + candidate.description)
    .join("\n");
}
