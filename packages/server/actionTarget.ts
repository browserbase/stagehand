import type { Action, ActionTarget } from "../protocol/types.js";
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

export function normalizeSnapshotRootXPath(xpath: string): string {
  const trimmed = xpath.trim();
  return trimmed === "/" ? "/html[1]" : trimmed;
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
  const xpath = normalizeSnapshotRootXPath(selector.replace(/^xpath=/iu, ""));
  const match =
    Object.entries(xpathMap).find(([, candidateXpath]) => candidateXpath === xpath) ??
    (xpath === "/html[1]"
      ? Object.entries(xpathMap).find(([, candidateXpath]) => candidateXpath === "/html")
      : undefined);
  return match ? actionTargetFromEncodedId(match[0] as EncodedId) : undefined;
}

export function selectorAndTargetForSnapshotElement(
  elementId: EncodedId,
  xpathMap: Record<string, string>,
): { selector: string; target?: ActionTarget } | undefined {
  const rawXpath = trimTrailingTextNode(xpathMap[elementId]);
  if (!rawXpath) return undefined;

  const xpath = normalizeSnapshotRootXPath(rawXpath);
  const selector = `xpath=${xpath}`;
  const target = actionTargetForSnapshotSelector(selector, xpathMap);
  return { selector, ...(target ? { target } : {}) };
}

/**
 * Refresh short-lived target identities from the current snapshot while keeping
 * cached selectors. Throws when a selector no longer resolves.
 */
export function rebindActionTargetsToSnapshot(
  actions: Action[],
  xpathMap: Record<string, string>,
): Action[] {
  return actions.map((action) => {
    const target = actionTargetForSnapshotSelector(action.selector, xpathMap);
    if (!target) {
      throw new Error(`Cached action no longer resolves: ${action.selector}`);
    }

    const destinationSelector = action.method === "dragAndDrop" ? action.arguments?.[0] : undefined;
    const destinationTarget = destinationSelector
      ? actionTargetForSnapshotSelector(destinationSelector, xpathMap)
      : undefined;
    if (destinationSelector && !destinationTarget) {
      throw new Error(`Cached action argument no longer resolves: ${destinationSelector}`);
    }

    return {
      ...action,
      target,
      ...(destinationTarget ? { argumentTargets: { "0": destinationTarget } } : {}),
    };
  });
}
