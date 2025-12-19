import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { A11yNode, A11yOptions } from "../lib/v3/types/private/snapshot";
import {
  buildHierarchicalTree,
  decorateRoles,
  extractUrlFromAXNode,
  isStructural,
  removeRedundantStaticTextChildren,
} from "../lib/v3/understudy/a11y/snapshot/a11yTree";

const axString = (value: string): Protocol.Accessibility.AXValue => ({
  type: "string",
  value,
});

const defaultOpts: A11yOptions = {
  focusSelector: undefined,
  experimental: false,
  tagNameMap: {},
  scrollableMap: {},
  encode: (backendNodeId: number) => `enc-${backendNodeId}`,
};

const makeAxNode = (
  overrides: Partial<Protocol.Accessibility.AXNode> = {},
): Protocol.Accessibility.AXNode => ({
  nodeId: overrides.nodeId ?? String(Math.random()),
  backendDOMNodeId:
    overrides.backendDOMNodeId ?? Math.floor(Math.random() * 1e6),
  role: overrides.role ?? axString("generic"),
  childIds: overrides.childIds ?? [],
  parentId: overrides.parentId,
  properties: overrides.properties ?? [],
  name: overrides.name,
  description: overrides.description,
  value: overrides.value,
  ignored: overrides.ignored ?? false,
});

describe("decorateRoles", () => {
  it("marks scrollable DOM nodes with tag labels and encoded ids", () => {
    const opts: A11yOptions = {
      ...defaultOpts,
      tagNameMap: {
        "enc-1": "div",
        "enc-2": "html",
        "enc-3": "#document",
        "enc-4": "#svg",
      },
      scrollableMap: { "enc-1": true, "enc-4": true },
    };
    const nodes = [
      makeAxNode({
        backendDOMNodeId: 1,
        role: { type: "string", value: "region" },
      }),
      makeAxNode({
        backendDOMNodeId: 2,
        role: { type: "string", value: "generic" },
      }),
      makeAxNode({
        backendDOMNodeId: 3,
        role: { type: "string", value: "generic" },
      }),
      makeAxNode({
        backendDOMNodeId: 4,
        role: { type: "string", value: "generic" },
      }),
    ];

    const decorated = decorateRoles(nodes, opts);
    expect(decorated).toMatchObject([
      { encodedId: "enc-1", role: "scrollable, div" },
      { encodedId: "enc-2", role: "scrollable, html" },
      { encodedId: "enc-3", role: "generic" },
      { encodedId: "enc-4", role: "scrollable, svg" },
    ]);
  });

  it("falls back when encoding fails", () => {
    const opts: A11yOptions = {
      ...defaultOpts,
      encode: () => {
        throw new Error("boom");
      },
    };
    const nodes = [makeAxNode({ backendDOMNodeId: 4 })];
    const decorated = decorateRoles(nodes, opts);
    expect(decorated[0]?.encodedId).toBeUndefined();
  });
});

describe("buildHierarchicalTree", () => {
  const opts: A11yOptions = {
    ...defaultOpts,
    tagNameMap: { root: "div", child: "span" },
  };

  it("drops structural nodes without children or names", async () => {
    const nodes: A11yNode[] = [
      {
        role: "generic",
        name: "",
        nodeId: "root",
        encodedId: "root",
        parentId: undefined,
        childIds: ["child"],
      },
      {
        role: "generic",
        name: "",
        nodeId: "child",
        encodedId: "child",
        parentId: "root",
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, opts);
    expect(tree).toEqual([]);
  });

  it("promotes select/combobox tag names for structural nodes", async () => {
    const nodes: A11yNode[] = [
      {
        role: "combobox",
        name: "Select",
        nodeId: "root",
        encodedId: "root",
        parentId: undefined,
        childIds: ["child"],
      },
      {
        role: "StaticText",
        name: "Option",
        nodeId: "child",
        encodedId: "child",
        parentId: "root",
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, {
      ...opts,
      tagNameMap: { root: "select" },
    });
    expect(tree[0]?.role).toBe("select");
  });

  it("drops structural parents with a single cleaned child while keeping it in place", async () => {
    const nodes: A11yNode[] = [
      {
        role: "generic",
        name: "",
        nodeId: "root",
        encodedId: "root",
        parentId: undefined,
        childIds: ["child"],
      },
      {
        role: "StaticText",
        name: "Ok",
        nodeId: "child",
        encodedId: "child",
        parentId: "root",
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, opts);
    expect(tree[0]?.role).toBe("StaticText");
  });

  it("drops structural parents entirely when all descendants are pruned", async () => {
    const nodes: A11yNode[] = [
      {
        role: "generic",
        name: "",
        nodeId: "root",
        encodedId: "root",
        parentId: undefined,
        childIds: ["child"],
      },
      {
        role: "generic",
        name: "",
        nodeId: "child",
        encodedId: "child",
        parentId: "root",
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, opts);
    expect(tree).toEqual([]);
  });

  it("renames structural nodes to their tag names when not combobox", async () => {
    const nodes: A11yNode[] = [
      {
        role: "generic",
        name: "Container",
        nodeId: "root",
        encodedId: "root",
        parentId: undefined,
        childIds: ["child-a", "child-b"],
      },
      {
        role: "StaticText",
        name: "A",
        nodeId: "child-a",
        encodedId: "child-a",
        parentId: "root",
        childIds: [],
      },
      {
        role: "StaticText",
        name: "B",
        nodeId: "child-b",
        encodedId: "child-b",
        parentId: "root",
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, {
      ...opts,
      tagNameMap: { root: "section" },
    });
    expect(tree[0]?.role).toBe("section");
  });

  it("skips nodes with negative node ids early", async () => {
    const nodes: A11yNode[] = [
      {
        role: "button",
        name: "Hidden",
        nodeId: "-1",
        encodedId: "hidden",
        parentId: undefined,
        childIds: [],
      },
    ];

    const { tree } = await buildHierarchicalTree(nodes, opts);
    expect(tree).toEqual([]);
  });
});

describe("isStructural", () => {
  it("marks generic/none/InlineTextBox roles as structural", () => {
    expect(isStructural("generic")).toBe(true);
    expect(isStructural("none")).toBe(true);
    expect(isStructural("InlineTextBox")).toBe(true);
    expect(isStructural("button")).toBe(false);
  });
});

describe("removeRedundantStaticTextChildren", () => {
  it("removes static text children whose concatenated text equals the parent name", () => {
    const parent: A11yNode = {
      role: "button",
      name: "HelloWorld",
      nodeId: "root",
    };
    const children: A11yNode[] = [
      { role: "StaticText", name: "Hello", nodeId: "c1" },
      { role: "StaticText", name: "World", nodeId: "c2" },
      { role: "button", name: "Child", nodeId: "c3" },
    ];
    const pruned = removeRedundantStaticTextChildren(parent, children);
    expect(pruned).toEqual([{ role: "button", name: "Child", nodeId: "c3" }]);
  });

  it("keeps static text when combined text differs", () => {
    const parent: A11yNode = {
      role: "button",
      name: "Hello World",
      nodeId: "root",
    };
    const children: A11yNode[] = [
      { role: "StaticText", name: "Hello", nodeId: "c1" },
      { role: "StaticText", name: "Mars", nodeId: "c2" },
    ];
    expect(removeRedundantStaticTextChildren(parent, children)).toEqual(
      children,
    );
  });
  it("returns original children when parent name is empty", () => {
    const parent: A11yNode = {
      role: "button",
      nodeId: "root",
    };
    const children: A11yNode[] = [
      { role: "StaticText", name: "Hello", nodeId: "c1" },
      { role: "StaticText", name: "World", nodeId: "c2" },
    ];
    expect(removeRedundantStaticTextChildren(parent, children)).toEqual(
      children,
    );
  });
});

describe("extractUrlFromAXNode", () => {
  it("returns trimmed URL string from node properties", () => {
    const node = makeAxNode({
      properties: [
        { name: "busy", value: axString("bar") },
        { name: "url", value: axString(" https://example.com ") },
      ],
    });
    expect(extractUrlFromAXNode(node)).toBe("https://example.com");
  });

  it("returns undefined when url property missing or invalid", () => {
    expect(
      extractUrlFromAXNode(makeAxNode({ properties: [] })),
    ).toBeUndefined();
    expect(
      extractUrlFromAXNode(
        makeAxNode({
          properties: [{ name: "url", value: { type: "number", value: 123 } }],
        }),
      ),
    ).toBeUndefined();
  });
});
