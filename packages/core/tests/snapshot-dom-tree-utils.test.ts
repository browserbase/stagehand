import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import {
  collectDomTraversalTargets,
  findNodeByBackendId,
  mergeDomNodes,
  shouldExpandNode,
} from "../lib/v3/understudy/a11y/snapshot/domTree";

let nextNodeId = 1;
const makeNode = (
  overrides: Partial<Protocol.DOM.Node> = {},
): Protocol.DOM.Node => {
  const base: Protocol.DOM.Node = {
    nodeId: nextNodeId++,
    backendNodeId: nextNodeId++,
    nodeType: 1,
    nodeName: "DIV",
    localName: "div",
    nodeValue: "",
    childNodeCount:
      overrides.childNodeCount ??
      (overrides.children ? overrides.children.length : 0),
  };
  return { ...base, ...overrides };
};

describe("shouldExpandNode", () => {
  it("returns true when declared children exceed realized children", () => {
    const node = makeNode({
      childNodeCount: 2,
      children: [makeNode()],
    });
    expect(shouldExpandNode(node)).toBe(true);
  });

  it("returns false when all declared children are realized", () => {
    const child = makeNode();
    const node = makeNode({
      childNodeCount: 1,
      children: [child],
    });
    expect(shouldExpandNode(node)).toBe(false);
  });
});

describe("mergeDomNodes", () => {
  it("overrides structural fields with expanded node data", () => {
    const originalChildren = [makeNode({ nodeName: "SPAN" })];
    const target = makeNode({
      childNodeCount: 1,
      children: originalChildren,
      shadowRoots: [makeNode({ nodeName: "shadow-old" })],
      contentDocument: makeNode({ nodeName: "doc-old" }),
    });
    const source = makeNode({
      childNodeCount: 3,
      children: [makeNode({ nodeName: "DIV" })],
      shadowRoots: [],
      contentDocument: makeNode({ nodeName: "doc-new" }),
    });

    mergeDomNodes(target, source);

    expect(target.childNodeCount).toBe(3);
    expect(target.children).toEqual(source.children);
    expect(target.shadowRoots).toEqual([]);
    expect(target.contentDocument?.nodeName).toBe("doc-new");
  });

  it("preserves original structures when source omits them", () => {
    const child = makeNode();
    const target = makeNode({
      childNodeCount: 1,
      children: [child],
    });
    const source = makeNode({
      childNodeCount: 5,
    });

    mergeDomNodes(target, source);

    expect(target.childNodeCount).toBe(5);
    expect(target.children).toEqual([child]);
  });
});

describe("collectDomTraversalTargets", () => {
  it("returns children, shadow roots, and content document in order", () => {
    const childA = makeNode({ nodeName: "CHILD-A" });
    const childB = makeNode({ nodeName: "CHILD-B" });
    const shadow = makeNode({ nodeName: "SHADOW" });
    const content = makeNode({ nodeName: "CONTENT" });

    const node = makeNode({
      children: [childA, childB],
      shadowRoots: [shadow],
      contentDocument: content,
    });

    const targets = collectDomTraversalTargets(node);
    expect(targets).toEqual([childA, childB, shadow, content]);
  });
});

describe("findNodeByBackendId", () => {
  it("finds nodes nested within children and shadow roots", () => {
    const target = makeNode({ backendNodeId: 999, nodeName: "TARGET" });
    const root = makeNode({
      children: [
        makeNode({
          children: [makeNode(), target],
        }),
      ],
      shadowRoots: [makeNode()],
    });

    expect(findNodeByBackendId(root, 999)).toBe(target);
  });

  it("returns undefined when no node matches the backend id", () => {
    const root = makeNode({
      children: [makeNode()],
      shadowRoots: [makeNode()],
    });
    expect(findNodeByBackendId(root, 123456)).toBeUndefined();
  });
});
