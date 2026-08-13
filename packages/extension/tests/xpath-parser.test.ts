import { describe, expect, it } from "vitest";
import { applyPredicates, parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

describe("composed XPath predicate safety", () => {
  const elements = [{}, {}, {}] as Element[];

  it("does not coerce XPath index zero to the first match", () => {
    const [step] = parseXPathSteps("//div[0]");

    expect(applyPredicates(elements, step!.predicates)).toEqual([]);
  });

  it("does not silently ignore unsupported predicates", () => {
    const [step] = parseXPathSteps("//div[position() > 10]");

    expect(applyPredicates(elements, step!.predicates)).toEqual([]);
  });
});
