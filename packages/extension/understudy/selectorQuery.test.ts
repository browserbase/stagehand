import { describe, expect, it } from "vitest";
import {
  parseLegacySelector,
  planLegacySelector,
  parseXPathToSteps,
  buildXPathFromSteps,
} from "./selectorQuery.js";
import {
  legacyEngineCases,
  legacyRoutingCases,
  legacyXPathCases,
} from "./fixtures/legacySelectors.js";
import * as focusSelectors from "./a11y/snapshot/focusSelectors.js";

describe("pure legacy selector normalization", () => {
  it.each(legacyEngineCases)("engine: $name", ({ input, query }) => {
    expect(parseLegacySelector(input)).toEqual(query);
  });

  it.each(legacyRoutingCases)("routing: $name", ({ input, hops, selector }) => {
    expect(planLegacySelector(input)).toEqual({
      frameHopSelectors: hops,
      finalSelector: selector,
    });
  });
});

// Keep both import paths compatible while sharing the tokenizer implementation.
describe.each([
  { name: "query helpers", parse: parseXPathToSteps, build: buildXPathFromSteps },
  {
    name: "snapshot helpers",
    parse: focusSelectors.parseXPathToSteps,
    build: focusSelectors.buildXPathFromSteps,
  },
])("legacy XPath step normalization: $name", ({ parse, build }) => {
  it.each(legacyXPathCases)("$name", ({ input, steps, rebuilt }) => {
    expect(parse(input)).toEqual(steps);
    expect(build(parse(input))).toBe(rebuilt);
  });
});
