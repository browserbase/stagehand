import type { Step } from "../lib/v3/types/private/snapshot";
import { describe, expect, it } from "vitest";
import {
  buildXPathFromSteps,
  listChildrenOf,
  parseXPathToSteps,
} from "../lib/v3/understudy/a11y/snapshot/focusSelectors";

describe("parseXPathToSteps", () => {
  it("records axis direction and normalized names", () => {
    const steps = parseXPathToSteps(" //iframe[1]/div[2]//SPAN ");
    expect(steps).toEqual([
      { axis: "desc", raw: "iframe[1]", name: "iframe" },
      { axis: "child", raw: "div[2]", name: "div" },
      { axis: "desc", raw: "SPAN", name: "span" },
    ]);
  });

  it("drops empty segments and returns [] for blank input", () => {
    expect(parseXPathToSteps("   ")).toEqual([]);
    expect(parseXPathToSteps("/ ")).toEqual([]);
  });
});

describe("buildXPathFromSteps", () => {
  it("reconstructs descendant and child hops as a string", () => {
    const steps: ReadonlyArray<Step> = [
      { axis: "child", raw: "iframe[1]", name: "iframe" },
      { axis: "desc", raw: "div[@id='main']", name: "div" },
      { axis: "child", raw: "span", name: "span" },
    ];
    expect(buildXPathFromSteps(steps)).toBe("/iframe[1]//div[@id='main']/span");
  });

  it("returns '/' for empty sequences", () => {
    expect(buildXPathFromSteps([])).toBe("/");
  });
});

describe("listChildrenOf", () => {
  it("returns direct children whose parent matches the provided id", () => {
    const parentByFrame = new Map<string, string | null>([
      ["frame-1", null],
      ["frame-2", "frame-1"],
      ["frame-3", "frame-1"],
      ["frame-4", "frame-2"],
    ]);
    expect(listChildrenOf(parentByFrame, "frame-1")).toEqual([
      "frame-2",
      "frame-3",
    ]);
    expect(listChildrenOf(parentByFrame, "frame-4")).toEqual([]);
  });
});
