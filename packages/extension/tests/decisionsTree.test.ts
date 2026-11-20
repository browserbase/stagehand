import { describe, expect, it } from "vitest";
import { buildView, describeCandidate, parseOutline } from "../services/decisions/tree.js";

const OUTLINE = [
  "[0-1] RootWebArea: Contact",
  "  [0-2] heading: Contact us",
  "  [0-3] form: Contact form",
  "    [0-4] LabelText: First name",
  "    [0-5] textbox: First name",
  "    [0-6] checkbox: Subscribe [checked]",
  "    [0-7] select: Favourite colour",
  "      [0-8] MenuListPopup",
  "        [0-9] option: Red [selected]",
  "        [0-10] option: Green",
  "    [0-11] button",
  "      [0-12] StaticText: Send message",
  "  [0-13] link: Opens: 10:30",
].join("\n");

describe("decisions act outline parsing", () => {
  it("recovers depth, parents, names, and state flags", () => {
    const nodes = parseOutline(OUTLINE);

    expect(nodes).toHaveLength(13);
    expect(nodes[4]).toMatchObject({ id: "0-5", role: "textbox", name: "First name", depth: 2 });
    expect(nodes[nodes[4]!.parent!]!.id).toBe("0-3");
    expect(nodes[5]).toMatchObject({ role: "checkbox", name: "Subscribe", flags: ["checked"] });
    expect(nodes[12]).toMatchObject({ role: "link", name: "Opens: 10:30", depth: 1 });
  });

  it("filters views by family", () => {
    const nodes = parseOutline(OUTLINE);
    const ids = (kind: Parameters<typeof buildView>[1]) =>
      buildView(nodes, kind).map((node) => node.id);

    expect(ids("pointer")).toEqual(["0-6", "0-11", "0-13"]);
    expect(ids("input")).toEqual(["0-5"]);
  });

  it("describes candidates with ancestor, heading, and label context", () => {
    const nodes = parseOutline(OUTLINE);

    expect(describeCandidate(nodes, nodes[10]!)).toEqual({
      role: "button",
      text: "Send message",
      within: ["form: Contact form", "RootWebArea: Contact"],
      under_heading: "Contact us",
    });
    expect(describeCandidate(nodes, nodes[4]!)).toMatchObject({ near_text: "First name" });
  });

  it.each(["before", "after"])("reads nested label text %s a control", (position) => {
    const label = "  [0-2] LabelText\n    [0-3] StaticText: Country";
    const control = "  [0-4] select";
    const nodes = parseOutline(
      "[0-1] form\n" + (position === "before" ? `${label}\n${control}` : `${control}\n${label}`),
    );
    const candidate = nodes.find((node) => node.id === "0-4")!;
    expect(describeCandidate(nodes, candidate)).toMatchObject(
      position === "before" ? { near_text: "Country" } : { text_after: "Country" },
    );
  });
  it("joins continuation lines into the previous name and numbers identical controls", () => {
    const nodes = parseOutline(
      ["[0-1] button: Add to", "cart", "[0-2] button: Add to cart"].join("\n"),
    );
    expect(nodes.map((node) => node.name)).toEqual(["Add to cart", "Add to cart"]);
    expect(describeCandidate(nodes, nodes[1]!)).toMatchObject({ occurrence: "2 of 2" });
  });
});
