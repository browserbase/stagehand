import type { Protocol } from "devtools-protocol";
import type { Locator } from "../locator.js";
import type { Page } from "../page.js";
import type { Progress } from "../progress.js";
import type { ApcAction } from "./actions.js";
import { isRedacted } from "./actions.js";
import { formatAnnotatedPageContentCandidate } from "./format.js";
import type { AXRoleJson, ContentAttributesJson } from "./common_quality_data_pb.js";
import type { ApcQueryNode, ApcQueryResult } from "./query.js";
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
  const prepared = prepareAnnotatedPageContentCandidates(query, progress);
  const labeled =
    action === undefined
      ? prepared.candidates
      : await labelUnnamedCandidates(query, prepared, progress);
  const result = { ...prepared, candidates: numberIdenticalDescriptions(labeled) };
  const limitations: ApcCandidateResult["limitations"] =
    action === "upload"
      ? ["hidden-file-inputs"]
      : action === "select"
        ? ["select-option-disabled-state"]
        : [];
  if (action !== "upload") {
    return { ...result, content: candidateContent(result.candidates), limitations };
  }

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
    candidates.push({ id: target.id, description: describeCandidate(node, {}, progress) });
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

type DescriptionHints = { label?: string; ariaRole?: AXRoleJson };

/** APC omits the role of plain anchors and the path of links; both separate otherwise identical choices. */
function describeCandidate(
  node: ApcQueryNode,
  hints: DescriptionHints,
  progress?: Progress,
): string {
  const attributes = node.source.contentAttributes;
  if (!attributes || isRedacted(attributes)) {
    return formatAnnotatedPageContentCandidate(node, progress);
  }
  const ariaRole =
    hints.ariaRole ??
    (hasUnknownRole(attributes) && attributes.attributeType === "CONTENT_ATTRIBUTE_ANCHOR"
      ? "AX_ROLE_LINK"
      : attributes.ariaRole);
  const description = formatAnnotatedPageContentCandidate(
    {
      ...node,
      source: {
        ...node.source,
        contentAttributes: {
          ...attributes,
          ariaRole,
          // The formatter prints a control type before the role; "unspecified" says nothing.
          ...(attributes.formControlData && !hasControlType(attributes)
            ? { formControlData: { ...attributes.formControlData, formControlType: undefined } }
            : {}),
        },
      },
      label: hints.label ?? node.label,
    },
    progress,
  );
  const path = urlPath(attributes.anchorData?.url);
  return path === undefined ? description : description + " [href=" + JSON.stringify(path) + "]";
}

function hasControlType(attributes: ContentAttributesJson): boolean {
  const type = attributes.formControlData?.formControlType;
  return !!type && type !== "FORM_CONTROL_TYPE_UNSPECIFIED";
}

function hasUnknownRole(attributes: ContentAttributesJson): boolean {
  return (
    !hasControlType(attributes) &&
    (attributes.ariaRole === undefined || attributes.ariaRole === "AX_ROLE_UNKNOWN")
  );
}

function urlPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/**
 * APC has no name for controls labeled only by adjacent text or by ARIA it does not report.
 * Ask the accessibility tree, and for checkboxes and radios read the nearby text, so the
 * decision model does not have to choose between identical descriptions. Redacted controls
 * are never read.
 */
async function labelUnnamedCandidates(
  query: ApcQueryResult,
  result: ApcCandidateResult,
  progress: Progress,
): Promise<ApcCandidate[]> {
  const nodesById = new Map<string, ApcQueryNode>();
  for (const node of query.nodes) if (node.id !== undefined) nodesById.set(node.id, node);
  const labeled = await Promise.all(
    result.candidates.map(async (candidate) => {
      const node = nodesById.get(candidate.id);
      const target = result.targetsById.get(candidate.id);
      const attributes = node?.source.contentAttributes;
      if (!node || !target || !attributes || isRedacted(attributes) || node.label) {
        return candidate;
      }
      const hints = await accessibleNameAndRole(target, attributes);
      const controlType = attributes.formControlData?.formControlType;
      if (
        !hints.label &&
        (controlType === "FORM_CONTROL_TYPE_INPUT_CHECKBOX" ||
          controlType === "FORM_CONTROL_TYPE_INPUT_RADIO")
      ) {
        progress.throwIfStopped();
        hints.label = await nearbyText(target);
      }
      progress.throwIfStopped();
      if (!hints.label && !hints.ariaRole) return candidate;
      return { ...candidate, description: describeCandidate(node, hints, progress) };
    }),
  );
  progress.throwIfStopped();
  return labeled;
}

async function accessibleNameAndRole(
  target: ApcTarget,
  attributes: ContentAttributesJson,
): Promise<DescriptionHints> {
  try {
    const { nodes } =
      await target.frame.session.send<Protocol.Accessibility.GetPartialAXTreeResponse>(
        "Accessibility.getPartialAXTree",
        { backendNodeId: target.backendNodeId, fetchRelatives: false },
      );
    const ax = nodes.find((node) => node.backendDOMNodeId === target.backendNodeId) ?? nodes[0];
    const name = String(ax?.name?.value ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    const role = String(ax?.role?.value ?? "");
    const useRole =
      role &&
      hasUnknownRole(attributes) &&
      attributes.attributeType !== "CONTENT_ATTRIBUTE_ANCHOR" &&
      !/^(generic|none|unknown)$/iu.test(role);
    return {
      ...(name ? { label: name.slice(0, 120) } : {}),
      // The formatter prints the enum suffix, so a CDP role name renders the same way.
      ...(useRole ? { ariaRole: ("AX_ROLE_" + role.toUpperCase()) as AXRoleJson } : {}),
    };
  } catch {
    return {};
  }
}

async function nearbyText(target: ApcTarget): Promise<string | undefined> {
  let objectId: string | undefined;
  try {
    ({
      object: { objectId },
    } = await target.frame.session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
      backendNodeId: target.backendNodeId,
    }));
    if (!objectId) return undefined;
    const { result } = await target.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      { objectId, functionDeclaration: readNearbyText.toString(), returnByValue: true },
    );
    return typeof result.value === "string" && result.value ? result.value : undefined;
  } catch {
    return undefined;
  } finally {
    if (objectId) {
      await target.frame.session.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }
}

/** Runs in the page: the label, else adjacent text up to the next control or block. */
function readNearbyText(this: HTMLInputElement): string {
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  if (this.labels?.length) {
    const text = clean(
      Array.from(this.labels)
        .map((label) => label.innerText)
        .join(" "),
    );
    if (text) return text.slice(0, 80);
  }
  const stop = /^(BR|HR|INPUT|SELECT|TEXTAREA|BUTTON|P|DIV|LI|TR|TD|H[1-6])$/;
  const collect = (start: ChildNode | null, forward: boolean) => {
    const parts: string[] = [];
    for (let node = start; node; node = forward ? node.nextSibling : node.previousSibling) {
      if (
        node instanceof Element &&
        (stop.test(node.tagName) || node.querySelector("input,select,textarea,button"))
      ) {
        break;
      }
      const text = clean(node.textContent);
      if (text) parts.push(text);
      if (parts.join(" ").length > 60) break;
    }
    if (!forward) parts.reverse();
    return clean(parts.join(" "));
  };
  const text = collect(this.nextSibling, true) || collect(this.previousSibling, false);
  if (text) return text.slice(0, 80);
  // The parent's text is the label only when nothing in it is a block or another control.
  const parent = this.parentElement;
  const blocks = parent?.querySelectorAll(
    "input,select,textarea,button,p,div,li,tr,td,h1,h2,h3,h4,h5,h6",
  );
  return parent && blocks?.length === 1 ? clean(parent.innerText).slice(0, 80) : "";
}

/** Identical descriptions give the model no basis to choose; document order does. */
function numberIdenticalDescriptions(candidates: readonly ApcCandidate[]): ApcCandidate[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.description, (counts.get(candidate.description) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    const total = counts.get(candidate.description)!;
    if (total < 2) return candidate;
    const index = (seen.get(candidate.description) ?? 0) + 1;
    seen.set(candidate.description, index);
    return { ...candidate, description: `${candidate.description} [${index} of ${total}]` };
  });
}
