import { describe, expect, it } from "vitest";
import type { Protocol } from "devtools-protocol";

import { captureHybridSnapshot } from "../lib/v3/understudy/a11y/snapshot";
import { MockCDPSession } from "./helpers/mockCDPSession";
import type { Page } from "../lib/v3/understudy/page";
import { StagehandDomProcessError } from "../lib/v3/types/public/sdkErrors";
import { CDPSessionLike } from "../lib/v3/understudy/cdp";

type Handler = (params?: Record<string, unknown>) => Promise<unknown> | unknown;

function createFakePage(session: CDPSessionLike): Page {
  const frameTree: Protocol.Page.FrameTree = {
    frame: {
      id: "root" as Protocol.Page.FrameId,
      loaderId: "root-loader" as Protocol.Network.LoaderId,
      url: "http://fake",
      domainAndRegistry: "fake",
      securityOrigin: "http://fake",
      mimeType: "text/html",
      secureContextType: "Secure",
      crossOriginIsolatedContextType: "NotIsolated",
      gatedAPIFeatures: [],
    },
    childFrames: [],
  };

  return {
    mainFrameId: () => "root",
    asProtocolFrameTree: () => frameTree,
    listAllFrameIds: () => ["root"],
    getSessionForFrame: () => session,
    getOrdinal: () => 0,
  } as unknown as Page;
}

function completeDomTree(): Protocol.DOM.Node {
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeType: 9,
    nodeName: "#document",
    childNodeCount: 1,
    children: [
      {
        nodeId: 2,
        backendNodeId: 2,
        nodeType: 1,
        nodeName: "HTML",
        childNodeCount: 1,
        children: [
          {
            nodeId: 3,
            backendNodeId: 3,
            nodeType: 1,
            nodeName: "BODY",
            childNodeCount: 1,
            children: [
              {
                nodeId: 4,
                backendNodeId: 4,
                nodeType: 1,
                nodeName: "DIV",
                childNodeCount: 0,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  } as Protocol.DOM.Node;
}

function truncatedDomTree(): Protocol.DOM.Node {
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeType: 9,
    nodeName: "#document",
    childNodeCount: 1,
    children: [
      {
        nodeId: 2,
        backendNodeId: 2,
        nodeType: 1,
        nodeName: "HTML",
        childNodeCount: 1,
        children: [],
      },
    ],
  } as Protocol.DOM.Node;
}

function htmlWithChildren(): Protocol.DOM.Node {
  return {
    nodeId: 2,
    backendNodeId: 2,
    nodeType: 1,
    nodeName: "HTML",
    childNodeCount: 1,
    children: [
      {
        nodeId: 3,
        backendNodeId: 3,
        nodeType: 1,
        nodeName: "BODY",
        childNodeCount: 1,
        children: [
          {
            nodeId: 4,
            backendNodeId: 4,
            nodeType: 1,
            nodeName: "DIV",
            childNodeCount: 0,
            children: [],
          },
        ],
      },
    ],
  } as Protocol.DOM.Node;
}

function simpleAxNodes(): Protocol.Accessibility.AXNode[] {
  const stringType: Protocol.Accessibility.AXValueType = "string";
  return [
    {
      nodeId: "1",
      role: { type: stringType, value: "RootWebArea" },
      backendDOMNodeId: 2,
      childIds: ["2"],
      ignored: false,
    },
    {
      nodeId: "2",
      role: { type: stringType, value: "generic" },
      name: { type: stringType, value: "Content" },
      backendDOMNodeId: 4,
      parentId: "1",
      childIds: [] as string[],
      ignored: false,
    },
  ];
}

const baseHandlers: Record<string, Handler> = {
  "DOM.enable": async () => ({}),
  "Runtime.enable": async () => ({}),
  "Accessibility.enable": async () => ({}),
  "Accessibility.getFullAXTree": async () => ({ nodes: simpleAxNodes() }),
};

function makeCborError(): Error {
  return new Error("CBOR: stack limit exceeded");
}

describe("captureHybridSnapshot CBOR fallbacks", () => {
  it("retries DOM.getDocument with reduced depths before succeeding", async () => {
    let domCalls = 0;
    const session = new MockCDPSession({
      ...baseHandlers,
      "DOM.getDocument": async (params) => {
        domCalls += 1;
        if (domCalls === 1) throw makeCborError();
        expect(params?.depth).toBe(256);
        return { root: completeDomTree() };
      },
    });

    const page = createFakePage(session);
    const snapshot = await captureHybridSnapshot(page);

    expect(snapshot.combinedTree).toContain("html");
    const depths = session
      .callsFor("DOM.getDocument")
      .map((c) => c.params?.depth);
    expect(depths).toEqual([-1, 256]);
  });

  it("throws StagehandDomProcessError after all DOM.getDocument attempts fail", async () => {
    const session = new MockCDPSession({
      ...baseHandlers,
      "DOM.getDocument": async () => {
        throw makeCborError();
      },
    });

    const page = createFakePage(session);
    await expect(captureHybridSnapshot(page)).rejects.toThrow(
      StagehandDomProcessError,
    );
  });

  it("hydrates truncated nodes by retrying DOM.describeNode depths", async () => {
    let domAttempts = 0;
    let describeAttempts = 0;

    const session = new MockCDPSession({
      ...baseHandlers,
      "DOM.getDocument": async (params) => {
        domAttempts += 1;
        if (domAttempts === 1) throw makeCborError();
        expect(params?.depth).toBe(256);
        return { root: truncatedDomTree() };
      },
      "DOM.describeNode": async (params) => {
        describeAttempts += 1;
        if (describeAttempts === 1) throw makeCborError();
        expect(params?.depth).toBe(64);
        return { node: htmlWithChildren() };
      },
    });

    const page = createFakePage(session);
    const snapshot = await captureHybridSnapshot(page);

    const describeDepths = session
      .callsFor("DOM.describeNode")
      .map((c) => c.params?.depth);
    expect(describeDepths).toEqual([-1, 64]);
    expect(snapshot.combinedXpathMap["0-4"]).toBe("/html[1]/body[1]/div[1]");
  });
});
