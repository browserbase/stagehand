import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import {
  buildSessionDomIndex,
  domMapsForSession,
  getDomTreeWithFallback,
  hydrateDomTree,
} from "../lib/v3/understudy/a11y/snapshot/domTree";
import { StagehandDomProcessError } from "../lib/v3/types/public/sdkErrors";
import { MockCDPSession } from "./helpers/mockCDPSession";

let nextNodeId = 1;
const makeDomNode = (
  overrides: Partial<Protocol.DOM.Node> = {},
): Protocol.DOM.Node => {
  const nodeId = overrides.nodeId ?? nextNodeId++;
  const backendNodeId = overrides.backendNodeId ?? nextNodeId++;
  const nodeName = overrides.nodeName ?? "DIV";
  const nodeType = overrides.nodeType ?? 1;
  const children = overrides.children ?? [];
  return {
    nodeId,
    backendNodeId,
    nodeName,
    nodeType,
    localName: overrides.localName ?? nodeName.toLowerCase(),
    nodeValue: overrides.nodeValue ?? "",
    childNodeCount: overrides.childNodeCount ?? children.length,
    children,
    shadowRoots: overrides.shadowRoots,
    contentDocument: overrides.contentDocument,
    isScrollable: overrides.isScrollable,
  };
};

const buildSampleDomTree = () => {
  const iframeChild = makeDomNode({ nodeName: "P" });
  const iframeBody = makeDomNode({
    nodeName: "BODY",
    children: [iframeChild],
    isScrollable: true,
  });
  const iframeHtml = makeDomNode({ nodeName: "HTML", children: [iframeBody] });
  const iframeDoc = makeDomNode({
    nodeName: "#document",
    nodeType: 9,
    children: [iframeHtml],
  });
  const iframeElement = makeDomNode({
    nodeName: "IFRAME",
    contentDocument: iframeDoc,
  });
  const scrollDiv = makeDomNode({
    nodeName: "DIV",
    isScrollable: true,
  });
  const body = makeDomNode({
    nodeName: "BODY",
    children: [scrollDiv, iframeElement],
  });
  const html = makeDomNode({ nodeName: "HTML", children: [body] });
  const root = makeDomNode({
    nodeName: "#document",
    nodeType: 9,
    children: [html],
  });
  return {
    root,
    html,
    body,
    scrollDiv,
    iframeElement,
    iframeDoc,
    iframeHtml,
    iframeBody,
    iframeChild,
  };
};

describe("hydrateDomTree", () => {
  it("expands truncated nodes by calling DOM.describeNode", async () => {
    const child = makeDomNode({ nodeName: "DIV" });
    const root = makeDomNode({
      nodeName: "HTML",
      childNodeCount: 1,
      children: [],
    });

    const session = new MockCDPSession({
      "DOM.describeNode": async () => ({
        node: {
          ...root,
          children: [child],
          childNodeCount: 1,
        },
      }),
    });

    await hydrateDomTree(session, root, true);
    expect(root.children).toEqual([child]);
  });

  it("retries describeNode when CBOR errors occur before succeeding", async () => {
    const child = makeDomNode({ nodeName: "DIV" });
    const root = makeDomNode({
      nodeName: "HTML",
      childNodeCount: 1,
      children: [],
    });

    let attempts = 0;
    const session = new MockCDPSession({
      "DOM.describeNode": async () => {
        attempts++;
        if (attempts === 1) throw new Error("CBOR: stack limit exceeded");
        return { node: { ...root, children: [child], childNodeCount: 1 } };
      },
    });

    await hydrateDomTree(session, root, true);
    expect(attempts).toBe(2);
    expect(root.children).toEqual([child]);
  });

  it("throws StagehandDomProcessError after exhausting describeNode retries", async () => {
    const root = makeDomNode({
      nodeName: "HTML",
      childNodeCount: 1,
      children: [],
    });
    const session = new MockCDPSession({
      "DOM.describeNode": async () => {
        throw new Error("CBOR: stack limit exceeded");
      },
    });

    await expect(hydrateDomTree(session, root, true)).rejects.toBeInstanceOf(
      StagehandDomProcessError,
    );
  });
});

describe("getDomTreeWithFallback", () => {
  it("retries DOM.getDocument after CBOR errors and returns the hydrated root", async () => {
    const root = makeDomNode({
      nodeName: "#document",
      nodeType: 9,
      children: [],
    });
    const depths: number[] = [];
    const session = new MockCDPSession({
      "DOM.getDocument": async (params) => {
        const depth = (params?.depth ?? 0) as number;
        depths.push(depth);
        if (depth === -1) throw new Error("CBOR: stack limit exceeded");
        return { root };
      },
      "DOM.describeNode": async () => ({ node: root }),
    });

    const result = await getDomTreeWithFallback(session, true);
    expect(result).toBe(root);
    expect(depths).toEqual([-1, 256]);
  });

  it("propagates non-CBOR DOM.getDocument errors", async () => {
    const session = new MockCDPSession({
      "DOM.getDocument": async () => {
        throw new Error("network fail");
      },
    });
    await expect(getDomTreeWithFallback(session, false)).rejects.toThrow(
      "network fail",
    );
  });

  it("throws StagehandDomProcessError when all depth attempts hit CBOR limits", async () => {
    const session = new MockCDPSession({
      "DOM.getDocument": async () => {
        throw new Error("CBOR: stack limit exceeded");
      },
    });
    await expect(getDomTreeWithFallback(session, false)).rejects.toBeInstanceOf(
      StagehandDomProcessError,
    );
  });
});

describe("buildSessionDomIndex", () => {
  it("collects absolute paths, scrollability, and content-document metadata", async () => {
    const tree = buildSampleDomTree();
    const session = new MockCDPSession({
      "DOM.enable": async () => ({}),
      "DOM.getDocument": async () => ({ root: tree.root }),
      "DOM.describeNode": async () => ({ node: tree.root }),
    });

    const index = await buildSessionDomIndex(session, true);

    expect(index.rootBackend).toBe(tree.root.backendNodeId);
    expect(index.absByBe.get(tree.body.backendNodeId)).toBe("/html[1]/body[1]");
    expect(index.absByBe.get(tree.scrollDiv.backendNodeId)).toBe(
      "/html[1]/body[1]/div[1]",
    );
    expect(index.scrollByBe.get(tree.scrollDiv.backendNodeId)).toBe(true);
    expect(index.docRootOf.get(tree.iframeHtml.backendNodeId)).toBe(
      tree.iframeDoc.backendNodeId,
    );
    expect(
      index.contentDocRootByIframe.get(tree.iframeElement.backendNodeId),
    ).toBe(tree.iframeDoc.backendNodeId);
  });
});

describe("domMapsForSession", () => {
  it("derives frame-relative xpath/tag/scrollable maps for a frame's document root", async () => {
    const tree = buildSampleDomTree();
    const session = new MockCDPSession({
      "DOM.enable": async () => ({}),
      "DOM.getDocument": async () => ({ root: tree.root }),
      "DOM.getFrameOwner": async () => ({
        backendNodeId: tree.iframeElement.backendNodeId,
      }),
      "DOM.describeNode": async () => ({ node: tree.root }),
    });

    const encode = (frameId: string, backendNodeId: number) =>
      `${frameId}-${backendNodeId}`;
    const maps = await domMapsForSession(
      session,
      "frame-A",
      true,
      encode,
      true,
    );

    const iframeDocKey = `frame-A-${tree.iframeDoc.backendNodeId}`;
    const iframeBodyKey = `frame-A-${tree.iframeBody.backendNodeId}`;
    const iframeChildKey = `frame-A-${tree.iframeChild.backendNodeId}`;

    expect(maps.tagNameMap[iframeDocKey]).toBe("#document");
    expect(maps.xpathMap[iframeDocKey]).toBe("/");
    expect(maps.xpathMap[iframeBodyKey]).toBe("/html[1]/body[1]");
    expect(maps.xpathMap[iframeChildKey]).toBe("/html[1]/body[1]/p[1]");
    expect(maps.scrollableMap[iframeBodyKey]).toBe(true);
    expect(Object.keys(maps.tagNameMap)).not.toContain(
      `frame-A-${tree.html.backendNodeId}`,
    );
  });

  it("falls back to the root document when frame owner lookup fails", async () => {
    const tree = buildSampleDomTree();
    const session = new MockCDPSession({
      "DOM.enable": async () => ({}),
      "DOM.getDocument": async () => ({ root: tree.root }),
      "DOM.getFrameOwner": async () => {
        throw new Error("owner lookup failed");
      },
      "DOM.describeNode": async () => ({ node: tree.root }),
    });

    const encode = (frameId: string, backendNodeId: number) =>
      `${frameId}-${backendNodeId}`;
    const maps = await domMapsForSession(
      session,
      "frame-B",
      false,
      encode,
      true,
    );

    expect(maps.xpathMap[`frame-B-${tree.html.backendNodeId}`]).toBe(
      "/html[1]",
    );
    expect(maps.xpathMap[`frame-B-${tree.scrollDiv.backendNodeId}`]).toBe(
      "/html[1]/body[1]/div[1]",
    );
  });
});
