import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import { queryAll } from "./queryAll.js";
import { filterTextMatches } from "./textQuery.js";

export type ElementChainResolution =
  | { mode: "count" }
  | { mode: "selected"; index: number }
  | { mode: "all" };

export function resolveElementChainResult(
  chain: LocatorChain,
  resolution: ElementChainResolution,
): number | Element | Element[] | null {
  const matches = resolveElementChain(chain);
  switch (resolution.mode) {
    case "count":
      return matches.length;
    case "selected":
      return matches[resolution.index] ?? null;
    case "all":
      return matches;
  }
}

export function resolveElementChain(
  chain: LocatorChain,
  scopes: readonly (Document | Element)[] = [document],
): Element[] {
  if (chain.steps.some((step) => step.type === "frame")) {
    throw new Error("Frame entry is not supported by the element chain resolver");
  }

  if (chain.steps.some((step) => step.type === "query" && step.selector.kind === "role")) {
    throw new Error("Role queries require the frame chain resolver");
  }

  let current: readonly (Document | Element)[] = scopes;
  let matches: Element[] = [];
  for (const step of chain.steps) {
    if (step.type === "nth") {
      const selected = matches[step.index];
      matches = selected ? [selected] : [];
    } else if (step.type === "filter") {
      matches = filterTextMatches(matches, step);
    } else if (step.type === "query" && step.selector.kind !== "role") {
      if (
        current.some(
          (scope) => scope instanceof Element && /^(iframe|frame)$/i.test(scope.localName),
        )
      ) {
        throw new Error("Frame entry is not supported by the element chain resolver");
      }
      matches = queryAll(step.selector, current).filter((node) => node instanceof Element);
    }
    current = matches;
    if (!matches.length) break;
  }
  return matches;
}
