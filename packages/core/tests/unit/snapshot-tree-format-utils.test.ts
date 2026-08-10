import { describe, expect, it } from "vitest";
import {
  cleanText,
  diffCombinedTrees,
  formatTreeLine,
  indentBlock,
  injectSubtrees,
  normaliseSpaces,
} from "../../lib/v3/understudy/a11y/snapshot/treeFormatUtils.js";

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

  it("renders a select with child options and only one selected option", () => {
    const outline = formatTreeLine({
      role: "select",
      name: "Select field",
      nodeId: "ax-4",
      children: [
        { role: "option", name: "Option A", nodeId: "ax-5" },
        {
          role: "option",
          name: "Option B",
          selected: true,
          nodeId: "ax-6",
        },
        { role: "option", name: "Option C", nodeId: "ax-7" },
      ],
    });

    expect(outline).toBe(
      "[ax-4] select: Select field\n  [ax-5] option: Option A\n  [ax-6] option: Option B [selected]\n  [ax-7] option: Option C",
    );
    expect(outline.match(/\[selected]/g)?.length ?? 0).toBe(1);
  });

  it("renders a radio group with children and only one checked radio", () => {
    const outline = formatTreeLine({
      role: "group",
      name: "Select field",
      nodeId: "ax-8",
      children: [
        { role: "radio", name: "Option A", nodeId: "ax-9" },
        { role: "radio", name: "Option B", checked: true, nodeId: "ax-10" },
        { role: "radio", name: "Option C", nodeId: "ax-11" },
      ],
    });

    expect(outline).toBe(
      "[ax-8] group: Select field\n  [ax-9] radio: Option A\n  [ax-10] radio: Option B [checked]\n  [ax-11] radio: Option C",
    );
    expect(outline.match(/\[checked]/g)?.length ?? 0).toBe(1);
  });

  it("renders both flags when a node carries both states", () => {
    const outline = formatTreeLine({
      role: "menuitemcheckbox",
      name: "Hybrid state",
      selected: true,
      checked: true,
      nodeId: "ax-12",
    });

    expect(outline).toBe(
      "[ax-12] menuitemcheckbox: Hybrid state [selected] [checked]",
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
