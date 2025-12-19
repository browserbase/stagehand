import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import {
  buildChildXPathSegments,
  joinXPath,
  normalizeXPath,
  prefixXPath,
} from "../lib/v3/understudy/a11y/snapshot/xpathUtils";
import { relativizeXPath } from "../lib/v3/understudy/a11y/snapshot/domTree";

describe("prefixXPath", () => {
  it("treats root prefixes as no-op", () => {
    expect(prefixXPath("/", "/div[1]")).toBe("/div[1]");
    expect(prefixXPath("/", "//div[1]")).toBe("//div[1]");
  });

  it("handles descendant hops and blank children", () => {
    expect(prefixXPath("/html/body", "//slot[1]")).toBe("/html/body//slot[1]");
    expect(prefixXPath("/html/body", "/")).toBe("/html/body");
    expect(prefixXPath("/html/body/", "")).toBe("/html/body");
  });
});

describe("normalizeXPath", () => {
  it("strips prefixes, trims whitespace, and enforces absolute roots", () => {
    expect(normalizeXPath("   xpath=/html/body/ ")).toBe("/html/body");
    expect(normalizeXPath("div/span")).toBe("/div/span");
    expect(normalizeXPath("")).toBe("");
    expect(normalizeXPath()).toBe("");
  });
});

describe("relativizeXPath", () => {
  it("returns '/' when paths match exactly", () => {
    expect(relativizeXPath("/html/body", "/html/body")).toBe("/");
  });

  it("omits duplicate prefixes and preserves descendant hops", () => {
    expect(relativizeXPath("/html/body", "/html/body/div[2]")).toBe("/div[2]");
    expect(relativizeXPath("/html/body", "/html/body//shadow-root[1]")).toBe(
      "//shadow-root[1]",
    );
  });

  it("falls back to absolute paths outside of the base document", () => {
    expect(relativizeXPath("/html/body", "/head")).toBe("/head");
    expect(relativizeXPath("/", "/html/body")).toBe("/html/body");
  });
});

describe("buildChildXPathSegments", () => {
  it("produces positional selectors for each node type", () => {
    const makeNode = (
      nodeType: number,
      nodeName: string,
      override?: Partial<Protocol.DOM.Node>,
    ): Protocol.DOM.Node => ({
      nodeId: 1,
      backendNodeId: 1,
      localName: nodeName.toLowerCase(),
      nodeValue: "",
      ...override,
      nodeType,
      nodeName,
    });

    const nodes: Protocol.DOM.Node[] = [
      makeNode(1, "DIV"),
      makeNode(1, "DIV"),
      makeNode(1, "svg:path"),
      makeNode(3, "#text"),
      makeNode(8, "#comment"),
    ];

    expect(buildChildXPathSegments(nodes)).toEqual([
      "div[1]",
      "div[2]",
      "*[name()='svg:path'][1]",
      "text()[1]",
      "comment()[1]",
    ]);
  });
});

describe("joinXPath", () => {
  it("joins base and steps while preserving special hops", () => {
    expect(joinXPath("", "div[1]")).toBe("/div[1]");
    expect(joinXPath("/", "span[1]")).toBe("/span[1]");
    expect(joinXPath("/html/body", "//")).toBe("/html/body//");
    expect(joinXPath("/html//", "slot[1]")).toBe("/html//slot[1]");
    expect(joinXPath("/html/body", "")).toBe("/html/body");
  });
});
