import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import { queryAll } from "./queryAll.js";

export type ElementChainResolution =
  | { mode: "count" }
  | { mode: "selected"; index: number }
  | { mode: "all" };

/** Apply final-result selection only after every intermediate step is complete. */
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

/**
 * Resolve a validated chain within one execution context. Intermediate matches
 * remain DOM objects: queryAll deduplicates by identity in prior-scope order,
 * before each positional step runs. Callers own exporting the final targets.
 */
export function resolveElementChain(
  chain: LocatorChain,
  scopes: readonly (Document | Element)[] = [document],
): Element[] {
  // Frame transitions require the cross-frame resolver; never interpret an
  // explicit hop as an ordinary element query, even after an empty prefix.
  if (chain.steps.some((step) => step.type === "frame")) {
    throw new Error("Frame entry is not supported by the element chain resolver");
  }

  if (chain.steps.some((step) => step.type !== "nth" && step.selector.kind === "role")) {
    throw new Error("Role queries require the frame chain resolver");
  }

  let current: readonly (Document | Element)[] = scopes;
  let matches: Element[] = [];
  for (const step of chain.steps) {
    if (step.type === "nth") {
      const selected = matches[step.index];
      matches = selected ? [selected] : [];
    } else if (step.type === "query" && step.selector.kind !== "role") {
      if (
        current.some(
          (scope) => scope instanceof Element && /^(iframe|frame)$/i.test(scope.localName),
        )
      ) {
        throw new Error("Frame entry is not supported by the element chain resolver");
      }
      // Legacy document XPath can return non-element nodes. They cannot become
      // element scopes or chain targets; leave the legacy collector unchanged.
      matches = queryAll(step.selector, current).filter((node) => node instanceof Element);
    }
    current = matches;
    if (!matches.length) break;
  }
  return matches;
}
