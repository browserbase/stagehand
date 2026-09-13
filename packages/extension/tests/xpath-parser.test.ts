import { describe, expect, it } from "vitest";
import { applyPredicates, parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

describe("composed XPath predicate safety", () => {
  const elements = [{}, {}, {}] as Element[];

  it("still applies supported index predicates", () => {
    const [step] = parseXPathSteps("//div[2]");

    expect(applyPredicates(elements, step!.predicates)).toEqual([elements[1]]);
  });

  it("does not coerce XPath index zero to the first match", () => {
    const [step] = parseXPathSteps("//div[0]");

    expect(applyPredicates(elements, step!.predicates)).toEqual([]);
  });

  it("rejects unsupported predicates instead of silently broadening matches", () => {
    const [step] = parseXPathSteps("//div[position() > 10]");

    expect(() => applyPredicates(elements, step!.predicates)).toThrow(
      "Unsupported XPath predicate in composed-tree traversal: position() > 10",
    );
  });
});
