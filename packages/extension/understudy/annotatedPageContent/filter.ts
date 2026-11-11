import type { Progress } from "../progress.js";
import type { AnnotatedPageContent } from "./index.js";
import type { ContentNodeJson, FrameDataJson } from "./common_quality_data_pb.js";
import { classifyActions, isRedacted, type ApcAction } from "./actions.js";

export type ApcFrame = {
  /** Capture-local identity, including when Chromium omits the document token. */
  id: string;
  data?: FrameDataJson;
};

export type ApcNode = {
  /** Stable within this capture across different filters; not a locator selector. */
  id: string;
  depth: number;
  source: ContentNodeJson;
  frame: ApcFrame;
  actions: ApcAction[];
  target: boolean;
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

/** Preorder outline retaining matches, their labels, and the paths connecting them. */
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
  const labels = new Map<string, number[]>();
  let frameNumber = 1;
  const pending = [
    {
      source: content.rootNode,
      depth: 0,
      parent: undefined as number | undefined,
      frame: { id: "frame-1", data: content.mainFrameData } as ApcFrame,
      hidden: false,
    },
  ];
  while (pending.length) {
    progress?.throwIfStopped();
    const item = pending.pop()!;
    const index = nodes.length;
    const attributes = item.source.contentAttributes;
    const suppressed =
      item.hidden || !!attributes?.annotatedRoles?.includes("ANNOTATED_ROLE_CONTENT_HIDDEN");
    const supported = suppressed ? [] : classifyActions(attributes);
    nodes.push({
      id: `apc-${index + 1}`,
      depth: item.depth,
      source: item.source,
      frame: item.frame,
      actions: supported,
      target:
        supported.length > 0 && (!filtered || supported.some((action) => actions.includes(action))),
    });
    parents.push(item.parent);
    hidden.push(suppressed);
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
      });
    }
  }
  if (!filtered) return nodes;

  const keep = nodes.map((node) => node.target);
  const labelRoots = new Set<number>();
  for (const node of nodes) {
    progress?.throwIfStopped();
    const domId = node.source.contentAttributes?.commonAncestorDomNodeId;
    if (!node.target || domId === undefined) continue;
    for (const index of labels.get(`${node.frame.id}:${domId}`) ?? []) {
      labelRoots.add(index);
      keep[index] = true;
    }
  }
  const textContext: boolean[] = [];
  for (let index = 0; index < nodes.length; index++) {
    progress?.throwIfStopped();
    const node = nodes[index]!;
    const attributes = node.source.contentAttributes;
    const parent = parents[index];
    const inherits =
      parent !== undefined &&
      textContext[parent] === true &&
      node.actions.length === 0 &&
      !hidden[index] &&
      !textBoundaries.has(attributes?.attributeType ?? "");
    // Scroll targets can contain an entire document. Keep their own metadata, not all its text.
    textContext[index] =
      labelRoots.has(index) ||
      (node.target &&
        node.actions.some((action) => action !== "scroll" && actions.includes(action))) ||
      inherits;
    if (
      inherits &&
      (attributes?.textData ||
        attributes?.svgRootData ||
        attributes?.imageData ||
        attributes?.label)
    ) {
      keep[index] = true;
    }
  }
  // A reverse pass retains each needed ancestor once, without keeping its unrelated children.
  for (let index = nodes.length - 1; index >= 0; index--) {
    progress?.throwIfStopped();
    const parent = parents[index];
    if (keep[index] && parent !== undefined) keep[parent] = true;
  }
  return nodes.filter((_, index) => keep[index]);
}
