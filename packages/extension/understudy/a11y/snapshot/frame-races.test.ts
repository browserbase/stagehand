import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import type { Page } from "../../page.js";
import { FrameRegistry } from "../../frameRegistry.js";
import { a11yForFrame, isFrameScopeError } from "./a11yTree.js";
import { captureHybridSnapshot, mergeFramesIntoSnapshot } from "./capture.js";

describe("hybrid snapshot frame races", () => {
  it("does not retry a detached same-process child against the main session", async () => {
    const liveFrames = new Set(["root", "child"]);
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") return { root: sameProcessDom() };
      if (method === "DOM.getFrameOwner") return { backendNodeId: 10 };
      if (method === "Accessibility.getFullAXTree") {
        if (params?.frameId === "root") return { nodes: rootAxNodes() };
        if (params?.frameId === "child") {
          liveFrames.delete("child");
          throw new Error("Frame with given id was not found");
        }
        throw new Error("unscoped AX fallback must not run on the main session");
      }
      return {};
    });
    const mainSession = session("main", send);
    const page = mockPage({ liveFrames, mainSession });

    const snapshot = await captureHybridSnapshot(page);
    const axCalls = send.mock.calls.filter(([method]) => method === "Accessibility.getFullAXTree");

    expect(axCalls.map(([, params]) => params)).toStrictEqual([
      { frameId: "root" },
      { frameId: "child" },
    ]);
    expect(snapshot.combinedTree).toContain("Stable root");
    expect(snapshot.perFrame?.map(({ frameId }) => frameId)).toStrictEqual(["root"]);
  });

  it("preserves the unscoped fallback for a live OOPIF session root", async () => {
    const liveFrames = new Set(["root", "child"]);
    const mainSend = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") return { root: rootDomWithIframe() };
      if (method === "DOM.getFrameOwner" && params?.frameId === "child") {
        return { backendNodeId: 10 };
      }
      if (method === "Accessibility.getFullAXTree" && params?.frameId === "root") {
        return { nodes: rootAxNodes() };
      }
      return {};
    });
    const childSend = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") return { root: childDocument() };
      if (method === "Accessibility.getFullAXTree" && params?.frameId === "child") {
        throw new Error("Frame does not belong to the target");
      }
      if (method === "Accessibility.getFullAXTree" && params === undefined) {
        return { nodes: childAxNodes("Live OOPIF child") };
      }
      return {};
    });
    const mainSession = session("main", mainSend);
    const childSession = session("oopif", childSend);
    const page = mockPage({ liveFrames, mainSession, childSession });

    const snapshot = await captureHybridSnapshot(page);
    const childAxCalls = childSend.mock.calls.filter(
      ([method]) => method === "Accessibility.getFullAXTree",
    );

    expect(childAxCalls.map(([, params]) => params)).toStrictEqual([
      { frameId: "child" },
      undefined,
    ]);
    expect(snapshot.combinedTree).toContain("Live OOPIF child");
    expect(snapshot.perFrame?.map(({ frameId }) => frameId)).toStrictEqual(["root", "child"]);
  });

  it("does not retry an OOPIF that detaches during its scoped request", async () => {
    const liveFrames = new Set(["root", "child"]);
    const mainSend = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") return { root: rootDomWithIframe() };
      if (method === "DOM.getFrameOwner" && params?.frameId === "child") {
        return { backendNodeId: 10 };
      }
      if (method === "Accessibility.getFullAXTree" && params?.frameId === "root") {
        return { nodes: rootAxNodes() };
      }
      return {};
    });
    const childSend = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") return { root: childDocument() };
      if (method === "Accessibility.getFullAXTree" && params?.frameId === "child") {
        liveFrames.delete("child");
        throw new Error("Frame with the given id was not found");
      }
      if (method === "Accessibility.getFullAXTree" && params === undefined) {
        throw new Error("unscoped AX fallback must not run after detach");
      }
      return {};
    });
    const mainSession = session("main", mainSend);
    const childSession = session("oopif", childSend);
    const page = mockPage({ liveFrames, mainSession, childSession });

    const snapshot = await captureHybridSnapshot(page);
    const childAxCalls = childSend.mock.calls.filter(
      ([method]) => method === "Accessibility.getFullAXTree",
    );

    expect(childAxCalls.map(([, params]) => params)).toStrictEqual([{ frameId: "child" }]);
    expect(snapshot.perFrame?.map(({ frameId }) => frameId)).toStrictEqual(["root"]);
  });

  it("keeps main-frame fallback and propagates unrelated CDP failures", async () => {
    const fallbackSend = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Accessibility.getFullAXTree" && params?.frameId === "root") {
        throw new Error("Frame with given id was not found");
      }
      if (method === "Accessibility.getFullAXTree" && params === undefined) {
        return { nodes: rootAxNodes() };
      }
      return {};
    });

    await expect(
      a11yForFrame(session("main", fallbackSend), "root", {
        allowUnscopedFrameFallback: () => true,
        tagNameMap: {},
        scrollableMap: {},
        encode: (backendNodeId) => `0-${backendNodeId}`,
      }),
    ).resolves.toMatchObject({ outline: expect.stringContaining("Stable root") });

    const unrelated = new Error("Target crashed while reading the accessibility tree");
    const failingSend = vi.fn(async (method: string) => {
      if (method === "Accessibility.getFullAXTree") throw unrelated;
      return {};
    });
    await expect(
      a11yForFrame(session("main", failingSend), "root", {
        allowUnscopedFrameFallback: () => true,
        tagNameMap: {},
        scrollableMap: {},
        encode: (backendNodeId) => `0-${backendNodeId}`,
      }),
    ).rejects.toBe(unrelated);
    expect(isFrameScopeError(unrelated)).toBe(false);
  });

  it("excludes a detached nested frame from merged output", () => {
    const snapshot = mergeFramesIntoSnapshot(
      {
        rootId: "root",
        frames: ["root", "child", "grandchild"],
        parentByFrame: new Map([
          ["root", null],
          ["child", "root"],
          ["grandchild", "child"],
        ]),
      },
      new Map([
        ["root", emptyMaps()],
        ["child", emptyMaps()],
        ["grandchild", emptyMaps()],
      ]),
      [
        { frameId: "root", outline: "[0-10] iframe: child" },
        { frameId: "child", outline: "[1-20] iframe: grandchild" },
        { frameId: "grandchild", outline: "button: stale nested content" },
      ],
      new Map([
        ["root", ""],
        ["child", "/html/body/iframe"],
      ]),
      new Map([
        ["child", "0-10"],
        ["grandchild", "1-20"],
      ]),
      ["root", "child"],
    );

    expect(snapshot.combinedTree).not.toContain("stale nested content");
    expect(snapshot.perFrame?.map(({ frameId }) => frameId)).toStrictEqual(["root", "child"]);
  });

  it("tracks a replacement frame independently after detach", () => {
    const registry = new FrameRegistry("page", "root");
    registry.onFrameAttached("child-a", "root", "main");
    expect(registry.hasFrame("child-a")).toBe(true);

    registry.onFrameDetached("child-a");
    registry.onFrameAttached("child-b", "root", "main");

    expect(registry.hasFrame("child-a")).toBe(false);
    expect(registry.hasFrame("child-b")).toBe(true);
    expect(registry.listAllFrames()).toStrictEqual(["root", "child-b"]);
  });
});

function mockPage({
  liveFrames,
  mainSession,
  childSession,
}: {
  liveFrames: Set<string>;
  mainSession: CDPSessionLike;
  childSession?: CDPSessionLike;
}): Page {
  return {
    logger: { warn: vi.fn() },
    mainFrameId: () => "root",
    asProtocolFrameTree: () => ({
      frame: protocolFrame("root"),
      childFrames: [{ frame: protocolFrame("child", "root") }],
    }),
    listAllFrameIds: () => ["root", "child"],
    hasFrame: (frameId: string) => liveFrames.has(frameId),
    getSessionForFrame: (frameId: string) =>
      frameId === "child" && liveFrames.has(frameId) && childSession ? childSession : mainSession,
    getOrdinal: (frameId: string) => (frameId === "root" ? 0 : 1),
  } as unknown as Page;
}

function session(id: string, send: ReturnType<typeof vi.fn>): CDPSessionLike {
  return { id, send } as unknown as CDPSessionLike;
}

function emptyMaps() {
  return { tagNameMap: {}, xpathMap: {}, scrollableMap: {}, urlMap: {} };
}

function rootAxNodes(): Protocol.Accessibility.AXNode[] {
  return [
    {
      nodeId: "root-ax",
      ignored: false,
      role: { type: "role", value: "RootWebArea" },
      name: { type: "computedString", value: "Stable root" },
      backendDOMNodeId: 1,
      childIds: ["iframe-ax"],
    },
    {
      nodeId: "iframe-ax",
      ignored: false,
      role: { type: "role", value: "Iframe" },
      name: { type: "computedString", value: "Child frame" },
      backendDOMNodeId: 10,
      parentId: "root-ax",
    },
  ];
}

function childAxNodes(name: string): Protocol.Accessibility.AXNode[] {
  return [
    {
      nodeId: "child-ax",
      ignored: false,
      role: { type: "role", value: "RootWebArea" },
      name: { type: "computedString", value: name },
      backendDOMNodeId: 20,
    },
  ];
}

function sameProcessDom(): Protocol.DOM.Node {
  const root = rootDomWithIframe();
  root.children![0]!.children![0]!.children![0]!.contentDocument = childDocument();
  return root;
}

function rootDomWithIframe(): Protocol.DOM.Node {
  return documentNode(1, [
    elementNode(2, "HTML", [elementNode(3, "BODY", [elementNode(10, "IFRAME")])]),
  ]);
}

function childDocument(): Protocol.DOM.Node {
  return documentNode(20, [
    elementNode(21, "HTML", [elementNode(22, "BODY", [elementNode(23, "BUTTON")])]),
  ]);
}

function documentNode(backendNodeId: number, children: Protocol.DOM.Node[]): Protocol.DOM.Node {
  return {
    nodeId: backendNodeId,
    backendNodeId,
    nodeType: 9,
    nodeName: "#document",
    localName: "",
    nodeValue: "",
    childNodeCount: children.length,
    children,
  };
}

function elementNode(
  backendNodeId: number,
  nodeName: string,
  children: Protocol.DOM.Node[] = [],
): Protocol.DOM.Node {
  return {
    nodeId: backendNodeId,
    backendNodeId,
    nodeType: 1,
    nodeName,
    localName: nodeName.toLowerCase(),
    nodeValue: "",
    childNodeCount: children.length,
    children,
  };
}

function protocolFrame(id: string, parentId?: string): Protocol.Page.Frame {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    loaderId: "loader",
    url: "http://fixture.test/",
    domainAndRegistry: "fixture.test",
    securityOrigin: "http://fixture.test",
    mimeType: "text/html",
    secureContextType: "InsecureScheme",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  };
}
