import { describe, expect, it } from "vitest";
import { parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

function predicatesOf(xpath: string) {
  return parseXPathSteps(xpath)[0]?.predicates;
}

describe("parseXPathSteps text predicates", () => {
  it("keeps text() and . apart", () => {
    expect(predicatesOf("//button[text()='Save']")).toEqual([
      { type: "textEquals", value: "Save", source: "text" },
    ]);
    expect(predicatesOf("//button[.='Save']")).toEqual([
      { type: "textEquals", value: "Save", source: "self" },
    ]);
  });

  it("keeps them apart inside contains() and normalize-space()", () => {
    expect(predicatesOf("//button[contains(text(),'Sa')]")).toEqual([
      { type: "textContains", value: "Sa", source: "text" },
    ]);
    expect(predicatesOf("//button[contains(.,'Sa')]")).toEqual([
      { type: "textContains", value: "Sa", source: "self" },
    ]);
    expect(predicatesOf("//button[normalize-space(text())='Save']")).toEqual([
      { type: "textEquals", value: "Save", normalize: true, source: "text" },
    ]);
    expect(predicatesOf("//button[normalize-space(.)='Save']")).toEqual([
      { type: "textEquals", value: "Save", normalize: true, source: "self" },
    ]);
  });

  it("carries the source through boolean predicates", () => {
    expect(predicatesOf("//button[text()='Save' or .='Save']")).toEqual([
      {
        type: "or",
        predicates: [
          { type: "textEquals", value: "Save", source: "text" },
          { type: "textEquals", value: "Save", source: "self" },
        ],
      },
    ]);
    expect(predicatesOf("//button[not(text()='Save')]")).toEqual([
      { type: "not", predicate: { type: "textEquals", value: "Save", source: "text" } },
    ]);
  });
});
