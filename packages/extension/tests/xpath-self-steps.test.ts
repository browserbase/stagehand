import { describe, expect, it } from "vitest";
import { parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

describe("parseXPathSteps self steps", () => {
  it("drops a leading . so a relative path resolves from the document", () => {
    expect(parseXPathSteps(".//div[@class='rel']")).toEqual(parseXPathSteps("//div[@class='rel']"));
    expect(parseXPathSteps("xpath=.//div")).toEqual(parseXPathSteps("//div"));
    expect(parseXPathSteps("./html/body")).toEqual(parseXPathSteps("/html/body"));
  });

  it("drops a . step in the middle of a path", () => {
    expect(parseXPathSteps("//section/./div")).toEqual(parseXPathSteps("//section/div"));
    expect(parseXPathSteps("//section/.//div")).toEqual(parseXPathSteps("//section//div"));
    expect(parseXPathSteps("//section/.")).toEqual(parseXPathSteps("//section"));
  });

  it("leaves a . predicate alone", () => {
    expect(parseXPathSteps("//button[.='Save']")).toEqual([
      {
        axis: "desc",
        tag: "button",
        predicates: [{ type: "textEquals", value: "Save", source: "self" }],
      },
    ]);
  });
});
