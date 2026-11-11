import type { Progress } from "../progress.js";
import type { AnnotatedPageContent } from "./index.js";
import type { ContentNodeJson, FrameDataJson } from "./common_quality_data_pb.js";
import { classifyActions, isDisabled, isRedacted, type ApcAction } from "./actions.js";

export type ApcFrame = {
  /** Capture-local identity, including when Chromium omits the document token. */
  id: string;
  data?: FrameDataJson;
};

export type ApcNode = {
  depth: number;
  source: ContentNodeJson;
  frame: ApcFrame;
  actions: ApcAction[];
  target: boolean;
  /** Intrinsic text or an explicitly associated label, for compact filtered output. */
  label?: string;
};

const textBoundaries = new Set([
  "CONTENT_ATTRIBUTE_ROOT",
  "CONTENT_ATTRIBUTE_IFRAME",
  "CONTENT_ATTRIBUTE_FORM",
  "CONTENT_ATTRIBUTE_FORM_CONTROL",
  "CONTENT_ATTRIBUTE_TABLE",
  "CONTENT_ATTRIBUTE_ORDERED_LIST",
  "CONTENT_ATTRIBUTE_UNORDERED_LIST",
]);

/** Preserve capture order and identity; action filters return only matching targets. */
export function filterAnnotatedPageContent(
  content: AnnotatedPageContent,
  actions: readonly ApcAction[] = [],
  progress?: Progress,
): ApcNode[] {
  progress?.throwIfStopped();
  if (!content.rootNode) return [];
  const filtered = actions.length > 0;
  const nodes: ApcNode[] = [];
  const parents: Array<number | undefined> = [];
  const hidden: boolean[] = [];
  const internal: boolean[] = [];
  const labels = new Map<string, number[]>();
  let frameNumber = 1;
  const pending = [
    {
      source: content.rootNode,
      depth: 0,
      parent: undefined as number | undefined,
      frame: { id: "frame-1", data: content.mainFrameData } as ApcFrame,
      hidden: false,
      insideControl: false,
    },
  ];
  while (pending.length) {
    progress?.throwIfStopped();
    const item = pending.pop()!;
    const index = nodes.length;
    const attributes = item.source.contentAttributes;
    const suppressed =
      item.hidden || !!attributes?.annotatedRoles?.includes("ANNOTATED_ROLE_CONTENT_HIDDEN");
    const supported = suppressed || item.insideControl ? [] : classifyActions(attributes);
    nodes.push({
      depth: item.depth,
      source: item.source,
      frame: item.frame,
      actions: supported,
      target:
        supported.length > 0 && (!filtered || supported.some((action) => actions.includes(action))),
    });
    parents.push(item.parent);
    hidden.push(suppressed);
    internal.push(item.insideControl);
    if (!suppressed && attributes?.labelForDomNodeId !== undefined) {
      const key = `${item.frame.id}:${attributes.labelForDomNodeId}`;
      const matches = labels.get(key) ?? [];
      matches.push(index);
      labels.set(key, matches);
    }
    // Never infer or recover content inside a redacted region.
    if (attributes?.iframeData?.redactedFrameMetadata || isRedacted(attributes)) continue;
    const frame =
      attributes?.iframeData || attributes?.attributeType === "CONTENT_ATTRIBUTE_IFRAME"
        ? { id: `frame-${++frameNumber}`, data: attributes.iframeData?.frameData }
        : item.frame;
    const children = item.source.childrenNodes ?? [];
    for (let child = children.length - 1; child >= 0; child--) {
      pending.push({
        source: children[child]!,
        depth: item.depth + 1,
        parent: index,
        frame,
        hidden: suppressed,
        insideControl:
          item.insideControl ||
          (!!attributes?.formControlData?.formControlType &&
            attributes.formControlData.formControlType !== "FORM_CONTROL_TYPE_CONTENT_EDITABLE" &&
            attributes.formControlData.formControlType !== "FORM_CONTROL_TYPE_UNSPECIFIED"),
      });
    }
  }

  const controls = new Set(
    nodes
      .filter((node) => node.source.contentAttributes?.formControlData)
      .map((node) => node.frame.id + ":" + node.source.contentAttributes?.commonAncestorDomNodeId),
  );
  for (const node of nodes) {
    progress?.throwIfStopped();
    const labelFor = node.source.contentAttributes?.labelForDomNodeId;
    if (labelFor !== undefined && controls.has(node.frame.id + ":" + labelFor)) {
      // A label activates its associated control; present that control once.
      node.target = false;
      node.actions = [];
    }
  }

  // Fold intrinsic text into its owning target instead of emitting context nodes.
  // Interactive descendants and structural boundaries own their own text.
  const descriptions: string[] = [];
  const childText: string[][] = nodes.map(() => []);
  for (let index = nodes.length - 1; index >= 0; index--) {
    progress?.throwIfStopped();
    const node = nodes[index]!;
    const attributes = node.source.contentAttributes;
    if (hidden[index] || isRedacted(attributes)) {
      descriptions[index] = "";
      continue;
    }
    const ownText =
      attributes?.label ||
      attributes?.textData?.textContent ||
      attributes?.svgRootData?.innerText ||
      attributes?.imageData?.imageCaption;
    descriptions[index] = ownText || childText[index]!.reverse().join(" ");
    const parent = parents[index];
    if (
      parent !== undefined &&
      node.actions.length === 0 &&
      !textBoundaries.has(attributes?.attributeType ?? "") &&
      !(attributes && isDisabled(attributes)) &&
      descriptions[index]
    ) {
      childText[parent]!.push(descriptions[index]!);
    }
  }

  const matches: ApcNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    progress?.throwIfStopped();
    const node = nodes[index]!;
    const attributes = node.source.contentAttributes;
    const domId = attributes?.commonAncestorDomNodeId;
    const associated = (labels.get(`${node.frame.id}:${domId}`) ?? [])
      .map((label) => descriptions[label])
      .filter(Boolean)
      .join(" ");
    // A scroll target may contain a whole document; its contents are not its label.
    const ownsText =
      node.actions.some(
        (action) => action !== "scroll" && (!filtered || actions.includes(action)),
      ) || !!attributes?.formControlData;
    node.label = isRedacted(attributes)
      ? attributes?.label
      : attributes?.label || associated || (ownsText ? descriptions[index] : undefined);
    node.label = node.label?.replace(/\s+/gu, " ").trim() || undefined;
    // Like snapshot, omit empty structural targets even when they carry mouse
    // handlers. A scroll region remains useful without a text label.
    if (isStructural(node) && !node.label && !node.actions.includes("scroll")) node.target = false;
    if (node.target) matches.push(node);
  }
  if (filtered) return matches;

  // Snapshot-style pruning: remove empty structural nodes, collapse single-child
  // wrappers, and fold redundant control text into the control's own line.
  const keep = nodes.map((_, index) => !internal[index]);
  const childCounts = nodes.map(() => 0);
  for (let index = nodes.length - 1; index >= 0; index--) {
    progress?.throwIfStopped();
    const node = nodes[index]!;
    if (isStructural(node) && !node.target && !node.label && childCounts[index]! <= 1)
      keep[index] = false;
    const parent = parents[index];
    if (parent !== undefined) childCounts[parent]! += keep[index] ? 1 : childCounts[index]!;
  }
  const depths: number[] = [];
  const result: ApcNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    progress?.throwIfStopped();
    const parent = parents[index];
    const depth = parent === undefined ? 0 : depths[parent]! + (keep[parent] ? 1 : 0);
    depths[index] = depth;
    if (keep[index]) result.push({ ...nodes[index]!, depth });
  }
  return result;
}

function isStructural(node: ApcNode): boolean {
  const attributes = node.source.contentAttributes;
  return (
    (!attributes?.attributeType || attributes.attributeType === "CONTENT_ATTRIBUTE_CONTAINER") &&
    !attributes?.formControlData &&
    (!attributes?.ariaRole ||
      attributes.ariaRole === "AX_ROLE_GENERICCONTAINER" ||
      attributes.ariaRole === "AX_ROLE_NONE") &&
    !attributes?.annotatedRoles?.length
  );
}
