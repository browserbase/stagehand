import type { SelectorQuery } from "../../understudy/selectorQuery.js";
import { collectCssMatches, collectTextMatches } from "./selectors.js";
import { collectXPathMatches } from "./xpathResolver.js";
import { collectNormalizedTextMatches } from "./textQuery.js";

/** Collect within one execution context, in scope order, deduplicated by DOM identity. */
export function queryAll(
  query: SelectorQuery,
  scopes: readonly (Document | Element)[] = [document],
  shadowPresence = new Map<Document, boolean>(),
): Element[] {
  const seen = new Set<Element>();
  const results: Element[] = [];
  for (const scope of scopes) {
    const matches = collectInScope(query, scope, shadowPresence);
    for (const element of matches) {
      if (seen.has(element)) continue;
      seen.add(element);
      results.push(element);
    }
  }
  return results;
}

function collectInScope(
  query: SelectorQuery,
  scope: Document | Element,
  shadowPresence: Map<Document, boolean>,
): Element[] {
  switch (query.kind) {
    case "css":
      return collectCssMatches(query.value, scope);
    case "text":
      return collectTextMatches(query.value, scope);
    case "textMatch":
      return collectNormalizedTextMatches(query.value, query, scope);
    case "xpath":
      return collectXPathMatches(query.value, { scope, pierceShadow: true, shadowPresence });
  }
}
