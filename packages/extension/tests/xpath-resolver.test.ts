import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countXPathMatches,
  queryXPathMatches,
  resolveXPathAtIndex,
} from "../dom/locatorScripts/xpathResolver.js";

vi.mock("../dom/locatorScripts/shadowRoots.js", () => ({
  documentHasShadowRoot: () => false,
  getOpenOrClosedShadowRoot: () => null,
}));

describe("native XPath result access", () => {
  class TestElement {
    constructor(readonly id: number) {}
  }

  const evaluate = vi.fn();
  const snapshotItem = vi.fn();
  const target = new TestElement(0);

  beforeEach(() => {
    snapshotItem.mockReset().mockReturnValue(target);
    evaluate.mockReset().mockReturnValue({ snapshotLength: 10_000, snapshotItem });
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("document", { evaluate });
    vi.stubGlobal("XPathResult", { ORDERED_NODE_SNAPSHOT_TYPE: 7 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([undefined, { pierceShadow: false }])(
    "reads only the requested item from 10,000 native matches with options %j",
    (options) => {
      expect(resolveXPathAtIndex("//button", 9_999, options)).toBe(target);
      expect(snapshotItem.mock.calls.length).toBe(1);
      expect(snapshotItem.mock.calls[0]).toEqual([9_999]);
      expect(evaluate).toHaveBeenCalledExactlyOnceWith("//button", document, null, 7, null);
    },
  );

  it.each([undefined, { pierceShadow: false }])(
    "counts 10,000 native matches without reading their elements with options %j",
    (options) => {
      expect(countXPathMatches("//button", options)).toBe(10_000);
      expect(snapshotItem.mock.calls.length).toBe(0);
      expect(evaluate).toHaveBeenCalledOnce();
    },
  );

  it("materializes native results in snapshot order for all-match callers", () => {
    const elements = Array.from({ length: 3 }, (_, index) => new TestElement(index));
    evaluate.mockReturnValue({ snapshotLength: elements.length, snapshotItem });
    snapshotItem.mockImplementation((index: number) => elements[index]);

    expect(queryXPathMatches("//button")).toEqual(elements);
    expect(snapshotItem.mock.calls).toEqual([[0], [1], [2]]);
  });

  it.each([
    { name: "attribute", node: { nodeType: 2 }, selector: "//button/@id" },
    { name: "text", node: { nodeType: 3 }, selector: "//button/text()" },
  ])("excludes $name nodes from all-match results", ({ node, selector }) => {
    evaluate.mockReturnValue({ snapshotLength: 1, snapshotItem });
    snapshotItem.mockReturnValue(node);

    expect(queryXPathMatches(selector)).toEqual([]);
  });

  it("preserves element order in a snapshot containing attributes and text", () => {
    const elements = [new TestElement(0), new TestElement(1)];
    const nodes = [elements[0], { nodeType: 2 }, { nodeType: 3 }, elements[1]];
    evaluate.mockReturnValue({ snapshotLength: nodes.length, snapshotItem });
    snapshotItem.mockImplementation((index: number) => nodes[index]);

    expect(queryXPathMatches("//button | //button/@id | //button/text()")).toEqual(elements);
    expect(snapshotItem.mock.calls).toEqual([[0], [1], [2], [3]]);
  });

  it("floors fractional indexes before reading the native snapshot", () => {
    expect(resolveXPathAtIndex("//button", 1.9)).toBe(target);
    expect(snapshotItem.mock.calls).toEqual([[1]]);
  });

  it.each([10_000, 2 ** 32])("returns null for an out-of-range index %i", (index) => {
    expect(resolveXPathAtIndex("//button", index)).toBeNull();
    expect(snapshotItem.mock.calls.length).toBe(0);
  });

  it("preserves empty results when native evaluation fails without shadow piercing", () => {
    evaluate.mockImplementation(() => {
      throw new Error("Invalid XPath");
    });
    const options = { pierceShadow: false };

    expect(resolveXPathAtIndex("invalid[", 0, options)).toBeNull();
    expect(countXPathMatches("invalid[", options)).toBe(0);
    expect(queryXPathMatches("invalid[", options)).toEqual([]);
  });
});
