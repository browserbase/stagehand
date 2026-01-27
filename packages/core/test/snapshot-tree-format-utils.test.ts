import { describe, expect, it } from "vitest";
import {
  cleanText,
  diffCombinedTrees,
  formatTreeLine,
  indentBlock,
  injectSubtrees,
  normaliseSpaces,
} from "../lib/v3/understudy/a11y/snapshot/treeFormatUtils";

describe("formatTreeLine", () => {
  it("includes encoded ids and indents children", () => {
    const outline = formatTreeLine({
      role: "section",
      name: "Container",
      encodedId: "frame-1",
      nodeId: "ax-1",
      children: [
        {
          role: "button",
          name: "Submit",
          nodeId: "ax-2",
        },
      ],
    });

    expect(outline).toBe(
      "[frame-1] section: Container\n  [ax-2] button: Submit",
    );
  });
});

describe("injectSubtrees", () => {
  it("nests child outlines under iframe encoded ids", () => {
    const rootOutline = `[root] document\n  [iframe-1] iframe\n  [leaf] item`;
    const iframeOutline = `[child-root] child\n  [nested-frame] iframe`;
    const nestedOutline = `[nested-leaf] nested`;

    const merged = injectSubtrees(
      rootOutline,
      new Map([
        ["iframe-1", iframeOutline],
        ["nested-frame", nestedOutline],
      ]),
    );

    expect(merged).toBe(
      `[root] document
  [iframe-1] iframe
    [child-root] child
      [nested-frame] iframe
        [nested-leaf] nested
  [leaf] item`,
    );
  });

  it("injects child outline only once when the same id repeats", () => {
    const rootOutline = `[root] document
  [iframe-1] iframe
  [iframe-1] iframe`;
    const iframeOutline = `[child-root] child`;

    const merged = injectSubtrees(
      rootOutline,
      new Map([["iframe-1", iframeOutline]]),
    );

    expect(merged).toBe(
      `[root] document
  [iframe-1] iframe
    [child-root] child
  [iframe-1] iframe`,
    );
  });

  it("returns the original outline when no encoded ids are matched", () => {
    const outline = `[root] document\n  [leaf] item`;
    expect(injectSubtrees(outline, new Map([["other", "[x] child"]]))).toBe(
      outline,
    );
  });
});

describe("indentBlock", () => {
  it("prefixes each line with the provided indent", () => {
    expect(indentBlock("a\nb", "  ")).toBe("  a\n  b");
    expect(indentBlock("", "  ")).toBe("");
  });
});

describe("diffCombinedTrees", () => {
  it("returns newly-added lines relative to previous outline", () => {
    const prev = `[root] document\n  [child] a`;
    const next = `[root] document\n  [child] a\n  [child-2] b`;
    expect(diffCombinedTrees(prev, next)).toBe("[child-2] b");
  });

  it("normalizes indentation for added lines with stray spaces", () => {
    const prev = `[root] document\n    [child] a`;
    const next = `[root] document\n    [child] a\n        [child-2] b`;
    expect(diffCombinedTrees(prev, next)).toBe("[child-2] b");
  });
});

describe("cleanText", () => {
  it("removes NBSP and private-use characters while collapsing spaces", () => {
    const dirty = `Hello\u00A0\u00A0world\uE000 !`;
    expect(cleanText(dirty)).toBe("Hello world !");
  });
});

describe("normaliseSpaces", () => {
  it("replaces whitespace runs with a single space", () => {
    expect(normaliseSpaces("a   b\tc\nd")).toBe("a b c d");
  });
});
