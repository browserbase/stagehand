import { decodeLocatorQuery, encodeLocatorQuery } from "../types/private/semanticLocator.js";
import { splitSelectorHops, splitXPathFrameHops } from "./selectorParser.js";
import { normalizeXPath } from "./a11y/snapshot/xpathUtils.js";

export type LocatorTargetPlan = {
  frameHopSelectors: string[];
  finalSelector: string;
};

/** Interpret selectors without choosing how long frame resolution may wait. */
export function planLocatorTarget(rawSelector: string): LocatorTargetPlan {
  const selector = rawSelector.trim();
  const steps = decodeLocatorQuery(selector);
  if (steps) {
    const first = steps[0];
    if (first?.kind !== "selector") return { frameHopSelectors: [], finalSelector: selector };
    const plan = planLocatorTarget(first.selector);
    return {
      ...plan,
      finalSelector: encodeLocatorQuery([
        { kind: "selector", selector: plan.finalSelector },
        ...steps.slice(1),
      ]),
    };
  }

  const parts = splitSelectorHops(selector);
  if (parts.length > 1) {
    return { frameHopSelectors: parts.slice(0, -1), finalSelector: parts.at(-1)! };
  }
  if (selector.startsWith("xpath=") || selector.startsWith("/")) {
    return planDeepXPathTarget(selector);
  }
  return { frameHopSelectors: [], finalSelector: selector };
}

/** Actions and semantic scopes target a terminal iframe element in its parent frame. */
export function planDeepXPathTarget(xpath: string): LocatorTargetPlan {
  const parts = splitXPathFrameHops(normalizeXPath(xpath));
  if (parts.length > 1 && parts.at(-1) === "/") parts.pop();
  return planXPathFragments(parts);
}

/** Legacy XPath snapshot scopes include the document inside a terminal iframe. */
export function planXPathSnapshotTarget(xpath: string): LocatorTargetPlan {
  return planXPathFragments(splitXPathFrameHops(normalizeXPath(xpath)));
}

function planXPathFragments(parts: string[]): LocatorTargetPlan {
  return {
    frameHopSelectors: parts.slice(0, -1).map((path) => `xpath=${path}`),
    finalSelector: `xpath=${parts.at(-1)!}`,
  };
}
