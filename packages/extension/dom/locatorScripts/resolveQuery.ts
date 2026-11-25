import type { SelectorQuery } from "../../understudy/selectorQuery.js";
import { countCssMatchesPrimary, countTextMatches, countXPathMatchesMainWorld } from "./counts.js";
import { collectCssMatches, collectTextMatches } from "./selectors.js";
import { collectXPathMatches } from "./xpathResolver.js";
import { collectNormalizedTextMatches } from "./textQuery.js";

export type SelectorResolution =
  | { mode: "count" }
  | { mode: "range"; start: number; end: number }
  | { mode: "all" };

export function resolveQuery(
  query: SelectorQuery,
  resolution: SelectorResolution,
): number | Element[] {
  if (resolution.mode === "count") {
    switch (query.kind) {
      case "css":
        return countCssMatchesPrimary(query.value);
      case "text":
        return countTextMatches(query.value).count;
      case "textMatch":
        return collectNormalizedTextMatches(query.value, query).length;
      case "xpath":
        return countXPathMatchesMainWorld(query.value);
    }
  }

  const start = resolution.mode === "range" ? resolution.start : 0;
  const end = resolution.mode === "range" ? resolution.end : Infinity;
  if (end <= start) return [];
  let matches: Element[];
  switch (query.kind) {
    case "css":
      matches = collectCssMatches(query.value, document, end);
      break;
    case "text":
      matches = collectTextMatches(query.value);
      break;
    case "textMatch":
      matches = collectNormalizedTextMatches(query.value, query);
      break;
    case "xpath":
      matches = collectXPathMatches(query.value, { pierceShadow: true }, end);
      break;
  }
  return matches.slice(start, end);
}
