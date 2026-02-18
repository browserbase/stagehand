import type { Step } from "../../lib/v3/types/private/snapshot.js";
import { describe, expect, it } from "vitest";
import {
  buildXPathFromSteps,
  IFRAME_STEP_RE,
  listChildrenOf,
  parseXPathToSteps,
} from "../../lib/v3/understudy/a11y/snapshot/focusSelectors.js";

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

describe("IFRAME_STEP_RE — frame boundary detection", () => {
  it("matches bare iframe", () => {
    expect(IFRAME_STEP_RE.test("iframe")).toBe(true);
  });

  it("matches iframe with positional index", () => {
    expect(IFRAME_STEP_RE.test("iframe[1]")).toBe(true);
    expect(IFRAME_STEP_RE.test("iframe[12]")).toBe(true);
  });

  it("matches bare frame (legacy <frameset> pages)", () => {
    expect(IFRAME_STEP_RE.test("frame")).toBe(true);
  });

  it("matches frame with positional index", () => {
    expect(IFRAME_STEP_RE.test("frame[4]")).toBe(true);
    expect(IFRAME_STEP_RE.test("frame[1]")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(IFRAME_STEP_RE.test("IFRAME")).toBe(true);
    expect(IFRAME_STEP_RE.test("FRAME")).toBe(true);
    expect(IFRAME_STEP_RE.test("IFrame[2]")).toBe(true);
    expect(IFRAME_STEP_RE.test("Frame[3]")).toBe(true);
  });

  it("does NOT match frameset", () => {
    expect(IFRAME_STEP_RE.test("frameset")).toBe(false);
    expect(IFRAME_STEP_RE.test("frameset[1]")).toBe(false);
  });

  it("does NOT match unrelated elements", () => {
    expect(IFRAME_STEP_RE.test("div")).toBe(false);
    expect(IFRAME_STEP_RE.test("body")).toBe(false);
    expect(IFRAME_STEP_RE.test("html")).toBe(false);
  });
});

describe("parseXPathToSteps — frameset XPaths", () => {
  it("parses a frameset page XPath with frame[N] steps", () => {
    const steps = parseXPathToSteps(
      "/html[1]/frameset[1]/frame[4]/html[1]/body[1]/table[1]",
    );
    expect(steps).toEqual([
      { axis: "child", raw: "html[1]", name: "html" },
      { axis: "child", raw: "frameset[1]", name: "frameset" },
      { axis: "child", raw: "frame[4]", name: "frame" },
      { axis: "child", raw: "html[1]", name: "html" },
      { axis: "child", raw: "body[1]", name: "body" },
      { axis: "child", raw: "table[1]", name: "table" },
    ]);
    // frame[4] step should be detected as a frame boundary
    const frameBoundaries = steps.filter((s) => IFRAME_STEP_RE.test(s.name));
    expect(frameBoundaries).toHaveLength(1);
    expect(frameBoundaries[0].raw).toBe("frame[4]");
  });

  it("detects iframe boundaries in standard iframe XPaths", () => {
    const steps = parseXPathToSteps(
      "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/p[1]",
    );
    const frameBoundaries = steps.filter((s) => IFRAME_STEP_RE.test(s.name));
    expect(frameBoundaries).toHaveLength(1);
    expect(frameBoundaries[0].raw).toBe("iframe[1]");
  });

  it("does NOT detect frameset as a frame boundary", () => {
    const steps = parseXPathToSteps("/html[1]/frameset[1]/frame[2]");
    const frameBoundaries = steps.filter((s) => IFRAME_STEP_RE.test(s.name));
    expect(frameBoundaries).toHaveLength(1);
    // Only frame[2] matches, not frameset[1]
    expect(frameBoundaries[0].raw).toBe("frame[2]");
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
