import type { ActionTarget } from "../protocol/types.js";
import type { EncodedId } from "./types/private/internal.js";
import { trimTrailingTextNode } from "./utils.js";

export class ActionTargetMismatchError extends Error {
  constructor(
    readonly expected: ActionTarget,
    readonly actual: ActionTarget,
  ) {
    super(
      `Observed action target changed: expected frame ${expected.frameOrdinal} node ${expected.backendNodeId}, ` +
        `resolved frame ${actual.frameOrdinal} node ${actual.backendNodeId}`,
    );
    this.name = "ActionTargetMismatchError";
  }
}

export function actionTargetFromEncodedId(elementId: EncodedId): ActionTarget {
  const [frameOrdinal, backendNodeId] = elementId.split("-").map(Number);
  return { frameOrdinal: frameOrdinal!, backendNodeId: backendNodeId! };
}

/**
 * Return the identity of the DOM element addressed by an emitted XPath.
 * Snapshot inference may select a text node whose XPath is normalized to its
 * parent element, so the selected encoded ID is not always the actionable ID.
 */
export function actionTargetForSnapshotSelector(
  selector: string,
  xpathMap: Record<string, string>,
): ActionTarget | undefined {
  const xpath = selector.replace(/^xpath=/iu, "");
  const match = Object.entries(xpathMap).find(([, candidateXpath]) => candidateXpath === xpath);
  return match ? actionTargetFromEncodedId(match[0] as EncodedId) : undefined;
}

export function selectorAndTargetForSnapshotElement(
  elementId: EncodedId,
  xpathMap: Record<string, string>,
): { selector: string; target?: ActionTarget } | undefined {
  const xpath = trimTrailingTextNode(xpathMap[elementId]);
  if (!xpath) return undefined;

  const selector = `xpath=${xpath}`;
  const target = actionTargetForSnapshotSelector(selector, xpathMap);
  return { selector, ...(target ? { target } : {}) };
}
