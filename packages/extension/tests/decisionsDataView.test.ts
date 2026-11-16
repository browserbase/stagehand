import { describe, expect, it } from "vitest";
import { buildDataView, readSlot } from "../services/decisions/dataView.js";

describe("nested record scopes", () => {
  it("keeps all list rows under the heading inside their section", () => {
    const tree = `[1] document
  [2] section
    [3] heading: Background
    [4] paragraph: An overview of the document
  [5] section
    [6] heading: Supported modes
    [7] paragraph: This introductory paragraph is deliberately longer than the limit for a short context label.
    [8] list
      [9] listitem
        [30] StaticText: Alpha
      [10] listitem
        [31] StaticText: Beta
      [11] listitem
        [32] StaticText: Gamma
  [12] section
    [13] heading: Archived modes
    [14] list
      [15] listitem
        [33] StaticText: Delta
      [16] listitem
        [34] StaticText: Epsilon
      [17] listitem
        [35] StaticText: Zeta`;
    const view = buildDataView(tree, {});
    const scoped = view.groups.find(
      (group) =>
        group.role === "listitem" &&
        group.sections.length === 1 &&
        group.sections[0] === "Supported modes",
    );
    expect(scoped?.records.map((row) => row.id)).toEqual(["9", "10", "11"]);
    expect(scoped?.context).toEqual(Array(3).fill("Supported modes"));
  });

  it("uses the enclosing description term as the scope for nested terms", () => {
    const view = buildDataView(
      `[1] DescriptionList
  [2] term: Account settings
  [3] definition
    [4] DescriptionList
      [5] term: Login
      [6] definition: Login help
      [7] term: Password
      [8] definition: Password help
      [9] term: Profile
      [10] definition: Profile help`,
      {},
    );
    const group = view.groups.find((candidate) => candidate.records[0]?.id === "5");
    expect(group?.context).toEqual(Array(3).fill("Account settings"));
  });

  it("collects leaf records across subsections without including the next section", () => {
    const tree = `[1] RootWebArea
  [2] heading: Catalog
  [3] div
    [4] heading: Fruit
    [5] list
      [6] listitem
        [7] link: apple
      [8] listitem
        [9] link: pear
    [10] heading: Vegetables
    [11] list
      [12] listitem
        [13] link: carrot
      [14] listitem
        [15] link: onion
  [16] heading: Archive
  [17] list
    [18] listitem
      [19] link: old apple
    [20] listitem
      [21] link: old pear`;
    const view = buildDataView(tree, {});
    const group = view.groups.find(
      (candidate) => candidate.sections.includes("Catalog") && candidate.role === "listitem",
    );
    expect(group?.records.map((record) => record.id)).toEqual(["6", "8", "12", "14"]);
    expect(group?.slots.flatMap((slot) => slot.samples)).not.toContain("old apple");
    expect(group?.slots.every((slot) => slot.coverage >= 0 && slot.coverage <= 1)).toBe(true);
  });

  it("keeps all terms across sibling sections despite differences in label markup", () => {
    const tree = `[1] RootWebArea
  [2] main
    [3] region: Basics
      [4] heading: Basics
      [5] DescriptionList
        [6] term: Open
        [7] definition: Open an item
        [8] term: Close
        [9] definition: Close an item
    [10] region: Advanced
      [11] heading: Advanced
      [12] DescriptionList
        [13] term: Export
          [14] link: Export
        [15] definition: Export an item
    [16] region: Other
      [17] heading: Other
      [18] DescriptionList
        [19] term: Print
          [20] code: Print
        [21] definition: Print an item
  [22] complementary
    [23] region: Archive
      [24] heading: Archive
      [25] DescriptionList
        [26] term: Obsolete
        [27] definition: Old command
        [28] term: Legacy
        [29] definition: Old command
        [30] term: Removed
        [31] definition: Old command`;
    const view = buildDataView(tree, {});
    const group = view.groups.find(
      (candidate) => candidate.role === "term" && candidate.records[0]?.id === "6",
    );
    expect(group?.records.map((record) => record.id)).toEqual(["6", "8", "13", "19"]);
    expect(group?.sections).toEqual(["Basics", "Advanced", "Other"]);
  });
});

it("keeps the trailing record when a repeating row sequence ends before its details", () => {
  const tree =
    "[1] table\n" +
    Array.from(
      { length: 7 },
      (_, i) =>
        `  [${i * 2 + 2}] row\n    [${i * 2 + 3}] ${i % 2 ? "StaticText: Details" : `link: Item ${i / 2 + 1}`}`,
    ).join("\n");
  const group = buildDataView(tree, {}).groups.find((candidate) => candidate.role === "row");
  expect(group?.records.map((record) => record.id)).toEqual(["2", "6", "10", "14"]);
});

it("keeps a bold list item as data rather than treating it as a table header", () => {
  const tree = `[1] list
  [2] listitem
    [3] strong: Featured
  [4] listitem
    [5] StaticText: Second
  [6] listitem
    [7] StaticText: Third`;
  const group = buildDataView(tree, {}).groups.find((candidate) => candidate.role === "listitem");
  expect(group?.records.map((record) => record.id)).toEqual(["2", "4", "6"]);
});

it("does not invent column headers from unnamed data cells", () => {
  const tree =
    "[1] table\n" +
    Array.from(
      { length: 3 },
      (_, i) => `  [${i * 5 + 2}] row
    [${i * 5 + 3}] cell
      [${i * 5 + 4}] StaticText: Plan ${i + 1}
    [${i * 5 + 5}] cell
      [${i * 5 + 6}] StaticText: ${i + 1} GB`,
    ).join("\n");
  const view = buildDataView(tree, {});
  const group = view.groups.find((candidate) => candidate.role === "row");
  expect(group?.records).toHaveLength(3);
  expect(group?.slots.every((slot) => slot.label === undefined)).toBe(true);
  expect(readSlot(view, group!.records[1]!, "cell[2]/statictext[1]")?.name).toBe("2 GB");
});

it("builds records for alternating labels and prose within one heading", () => {
  const tree = `[1] document
  [2] heading: Commands
  [3] paragraph
    [4] StaticText: Use the following commands.
  [5] paragraph
    [6] StaticText: Open
  [7] paragraph
    [8] StaticText: Opens the current project.
  [9] paragraph
    [10] StaticText: Save
  [11] paragraph
    [12] StaticText: Saves changes to disk.
  [13] paragraph
    [14] StaticText: Close
  [15] paragraph
    [16] StaticText: Closes the current project.
  [17] heading: Notes
  [18] paragraph
    [19] StaticText: Draft`;
  const group = buildDataView(tree, {}).groups.find((candidate) => candidate.role === "label");
  expect(group?.sections).toEqual(["Commands"]);
  expect(group?.records.map((record) => [record.id, record.name])).toEqual([
    ["6", "Open"],
    ["10", "Save"],
    ["14", "Close"],
  ]);
});
