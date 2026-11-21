import { describe, expect, it } from "vitest";
import { applyPredicatesPerParent, parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

function predicatesOf(xpath: string) {
  return parseXPathSteps(xpath)[0]!.predicates;
}

function child(parent: object, id: string, className = ""): Element {
  return {
    id,
    parentNode: parent,
    getAttribute: (name: string) => (name === "class" && className ? className : null),
  } as unknown as Element;
}

const ids = (elements: Element[]) => elements.map((element) => element.id);

describe("applyPredicatesPerParent", () => {
  const first = {};
  const second = {};
  // Document order, the way a descendant step collects them.
  const candidates = [
    child(first, "a1"),
    child(first, "a2"),
    child(first, "a3", "x"),
    child(second, "b1", "x"),
    child(second, "b2", "x"),
  ];

  it("counts a positional predicate within each parent", () => {
    expect(ids(applyPredicatesPerParent(candidates, predicatesOf("//div[1]")))).toEqual([
      "a1",
      "b1",
    ]);
    expect(ids(applyPredicatesPerParent(candidates, predicatesOf("//div[3]")))).toEqual(["a3"]);
    expect(applyPredicatesPerParent(candidates, predicatesOf("//div[4]"))).toEqual([]);
  });

  it("matches nothing at position zero", () => {
    // Positions start at 1, so [0] is an empty set rather than another spelling of [1].
    expect(predicatesOf("//div[0]")).toEqual([{ type: "index", index: 0 }]);
    expect(applyPredicatesPerParent(candidates, predicatesOf("//div[0]"))).toEqual([]);
  });

  it("counts after the predicates that precede the position", () => {
    // The first parent has a single .x child, so only the second one has a second.
    expect(ids(applyPredicatesPerParent(candidates, predicatesOf("//div[@class='x'][2]")))).toEqual(
      ["b2"],
    );
    expect(ids(applyPredicatesPerParent(candidates, predicatesOf("//div[2][@class='x']")))).toEqual(
      ["b2"],
    );
  });

  it("leaves non-positional predicates and document order alone", () => {
    const interleaved = [candidates[3]!, candidates[0]!, candidates[4]!, candidates[2]!];
    expect(ids(applyPredicatesPerParent(interleaved, predicatesOf("//div[@class='x']")))).toEqual([
      "b1",
      "b2",
      "a3",
    ]);
    expect(ids(applyPredicatesPerParent(interleaved, predicatesOf("//div[1]")))).toEqual([
      "b1",
      "a1",
    ]);
  });
});
