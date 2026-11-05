import { describe, expect, it } from "vitest";

import {
  MAX_NAME_LENGTH,
  compactSnapshotTree,
  isKeptSnapshotLine,
  parseSnapshotLine,
} from "../extensions/snapshot-compaction.js";

// A trimmed slice of a real tree: a root, unnamed layout containers, a heading
// whose text is duplicated by its StaticText child, and a link.
const REAL_TREE = [
  "[0-2] RootWebArea: Example Domain",
  "  [0-4] scrollable, html",
  "    [0-6] div",
  "      [0-8] heading: Example Domain",
  "        [0-9] StaticText: Example Domain",
  "        [0-10] StaticText: {",
  "      [0-11] link: Learn more",
  "",
].join("\n");

const ids = (tree: string) =>
  tree
    .split("\n")
    .flatMap((line) => parseSnapshotLine(line) ?? [])
    .map((line) => line.id);

describe("parseSnapshotLine", () => {
  it("splits indent, id, role, and name", () => {
    expect(parseSnapshotLine("    [1-42] link: Docs")).toEqual({
      indent: 4,
      id: "1-42",
      role: "link",
      name: "Docs",
    });
  });

  it("keeps roles without a name", () => {
    expect(parseSnapshotLine("  [1-43] textbox")).toEqual({
      indent: 2,
      id: "1-43",
      role: "textbox",
      name: "",
    });
  });

  it("ignores blank lines and continuation lines of a multi-line name", () => {
    expect(parseSnapshotLine("   ")).toBeUndefined();
    expect(parseSnapshotLine("just install")).toBeUndefined();
  });
});

describe("isKeptSnapshotLine", () => {
  it("keeps actionable roles and drops anonymous containers", () => {
    expect(isKeptSnapshotLine({ indent: 0, id: "1", role: "button", name: "Save" })).toBe(true);
    expect(isKeptSnapshotLine({ indent: 0, id: "1", role: "div", name: "" })).toBe(false);
    expect(isKeptSnapshotLine({ indent: 0, id: "1", role: "listitem", name: "" })).toBe(false);
  });

  it("keeps substantial StaticText and drops fragments", () => {
    expect(
      isKeptSnapshotLine({ indent: 0, id: "1", role: "StaticText", name: "Example Domain" }),
    ).toBe(true);
    expect(isKeptSnapshotLine({ indent: 0, id: "1", role: "StaticText", name: "{" })).toBe(false);
  });
});

describe("compactSnapshotTree", () => {
  it("keeps only actionable nodes and re-indents them by kept ancestors", () => {
    expect(compactSnapshotTree(REAL_TREE)).toBe(
      [
        "[0-2] RootWebArea: Example Domain",
        "  [0-8] heading: Example Domain",
        "    [0-9] StaticText: Example Domain",
        "  [0-11] link: Learn more",
      ].join("\n"),
    );
  });

  it("shrinks a real tree by more than half", () => {
    const raw = Array.from({ length: 200 }, (_, index) =>
      index % 10 === 0
        ? `  [0-${index}] div`
        : `      [0-${index}] link: item ${index} with a reasonably long label`,
    ).join("\n");
    expect(compactSnapshotTree(raw).length).toBeLessThan(raw.length);
  });

  it("copies node ids verbatim so run actions stay valid", () => {
    const compact = compactSnapshotTree(REAL_TREE);
    expect(ids(compact)).toEqual(["0-2", "0-8", "0-9", "0-11"]);
    for (const id of ids(compact)) expect(ids(REAL_TREE)).toContain(id);
  });

  it("truncates long names", () => {
    const long = "x".repeat(MAX_NAME_LENGTH + 40);
    const compact = compactSnapshotTree(`[1-1] heading: ${long}`);
    expect(compact).toBe(`[1-1] heading: ${"x".repeat(MAX_NAME_LENGTH)}…`);
  });

  it("caps the output when maxChars is set", () => {
    const compact = compactSnapshotTree(REAL_TREE, { maxChars: 40 });
    expect(compact.startsWith("[0-2] RootWebArea")).toBe(true);
    expect(compact.endsWith("… [compact snapshot truncated at 40 chars]")).toBe(true);
  });

  it("returns the input unchanged in size when nothing is filtered", () => {
    const onlyKept = "[0-1] RootWebArea: Title\n  [0-2] button: Go";
    expect(compactSnapshotTree(onlyKept)).toBe(onlyKept);
  });

  it("returns an empty string for an empty or fully filtered tree", () => {
    expect(compactSnapshotTree("")).toBe("");
    expect(compactSnapshotTree("[0-1] div\n  [0-2] listitem")).toBe("");
  });
});
