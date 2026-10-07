import { describe, expect, it } from "vitest";
import { filterInnermostMatches } from "../dom/locatorScripts/textMatches.js";

function element(parentElement: Element | null = null): Element {
  return { parentElement } as Element;
}

describe("innermost text matches", () => {
  it("removes matching ancestors across nonmatching elements and preserves order", () => {
    const root = element();
    const middle = element(root);
    const leaf = element(middle);
    const sibling = element(root);
    const other = element();
    const matches = [root, leaf, sibling, other].map((element, i) => ({ element, i }));
    expect(filterInnermostMatches(matches)).toEqual(matches.slice(1));
  });

  it("keeps matching shadow hosts alongside matches in their separate tree", () => {
    const host = element();
    const shadowChild = element();
    const nestedChild = element(shadowChild);
    const matches = [host, shadowChild, nestedChild].map((element) => ({ element }));
    expect(filterInnermostMatches(matches)).toEqual([matches[0], matches[2]]);
  });

  it("reads each shared ancestor once instead of comparing all pairs", () => {
    let ancestorReads = 0;
    const root = {
      get parentElement() {
        ancestorReads += 1;
        return null;
      },
    } as Element;
    const matches = Array.from({ length: 10_000 }, () => ({ element: element(root) }));
    expect(filterInnermostMatches(matches)).toEqual(matches);
    expect(ancestorReads).toBe(1);
  });
});
