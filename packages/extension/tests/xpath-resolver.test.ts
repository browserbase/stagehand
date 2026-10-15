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
  const evaluate = vi.fn();
  const snapshotItem = vi.fn();
  const target = {} as Element;

  beforeEach(() => {
    snapshotItem.mockReset().mockReturnValue(target);
    evaluate.mockReset().mockReturnValue({ snapshotLength: 10_000, snapshotItem });
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
    const elements = [{}, {}, {}] as Element[];
    evaluate.mockReturnValue({ snapshotLength: elements.length, snapshotItem });
    snapshotItem.mockImplementation((index: number) => elements[index]);

    expect(queryXPathMatches("//button")).toEqual(elements);
    expect(snapshotItem.mock.calls).toEqual([[0], [1], [2]]);
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
