import type { Protocol } from "devtools-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import type { Page } from "../../page.js";
import { resolveXpathForLocation } from "./coordinateResolver.js";

const { waitForMainWorld } = vi.hoisted(() => ({
  waitForMainWorld: vi.fn(),
}));

vi.mock("../../executionContextRegistry.js", () => ({
  executionContexts: {
    waitForMainWorld,
  },
}));

type SendHandler = (method: string, params?: object) => unknown;

function createSession(handler: SendHandler) {
  const send = vi.fn(async (method: string, params?: object) => handler(method, params));
  const session = {
    id: crypto.randomUUID(),
    send,
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  } as CDPSessionLike;
  return { send, session };
}

function frameTree(
  frameId: string,
  childFrames?: Protocol.Page.FrameTree[],
): Protocol.Page.FrameTree {
  return {
    frame: {
      id: frameId,
      loaderId: `loader-${frameId}`,
      url: "https://example.test",
      domainAndRegistry: "example.test",
      securityOrigin: "https://example.test",
      mimeType: "text/html",
      secureContextType: "Secure",
      crossOriginIsolatedContextType: "NotIsolated",
      gatedAPIFeatures: [],
    },
    childFrames,
  };
}

function createPage(tree: Protocol.Page.FrameTree, sessions: Record<string, CDPSessionLike>): Page {
  return {
    getFullFrameTree: () => tree,
    mainFrameId: () => tree.frame.id,
    getSessionForFrame: (frameId: string) => sessions[frameId]!,
  } as unknown as Page;
}

describe("resolveXpathForLocation", () => {
  beforeEach(() => {
    waitForMainWorld.mockReset();
  });

  it("resolves a main-frame node using document coordinates", async () => {
    waitForMainWorld.mockResolvedValue(17);
    const { send, session } = createSession((method, params) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { sx: 5.5, sy: 7.9 } } };
      }
      if (method === "DOM.getNodeForLocation") {
        expect(params).toStrictEqual({
          x: 16,
          y: 28,
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: false,
        });
        return { backendNodeId: 42 };
      }
      if (method === "DOM.resolveNode") {
        expect(params).toStrictEqual({ backendNodeId: 42 });
        return { object: { objectId: "node-42" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: "/html/body/button[2]" } };
      }
      return {};
    });
    const page = createPage(frameTree("main"), { main: session });

    await expect(resolveXpathForLocation(page, 10.8, 20.2)).resolves.toStrictEqual({
      frameId: "main",
      backendNodeId: 42,
      absoluteXPath: "/html/body/button[2]",
    });
    expect(waitForMainWorld).toHaveBeenCalledWith(session, "main");
    expect(send).toHaveBeenCalledWith("Runtime.evaluate", {
      contextId: 17,
      expression: expect.any(String),
      returnByValue: true,
    });
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "node-42",
    });
  });

  it("translates coordinates and builds an XPath across an iframe", async () => {
    waitForMainWorld.mockResolvedValue(undefined);
    let iframeResolveCount = 0;
    const { send: parentSend, session: parentSession } = createSession((method, params) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { sx: 0, sy: 0 } } };
      }
      if (method === "DOM.getNodeForLocation") {
        return { backendNodeId: 100 };
      }
      if (method === "DOM.getFrameOwner") {
        expect(params).toStrictEqual({ frameId: "child" });
        return { backendNodeId: 100 };
      }
      if (method === "DOM.resolveNode") {
        iframeResolveCount += 1;
        return {
          object: {
            objectId: iframeResolveCount === 1 ? "iframe-bounds" : "iframe-xpath",
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        const objectId = (params as { objectId?: string }).objectId;
        return objectId === "iframe-bounds"
          ? { result: { value: { left: 30, top: 40 } } }
          : { result: { value: "/html/body/iframe" } };
      }
      return {};
    });
    const { send: childSend, session: childSession } = createSession((method, params) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { sx: 0, sy: 0 } } };
      }
      if (method === "DOM.getNodeForLocation") {
        expect(params).toMatchObject({ x: 70, y: 80 });
        return { backendNodeId: 200 };
      }
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "child-node" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: "/html/body/button" } };
      }
      return {};
    });
    const tree = frameTree("main", [frameTree("child")]);
    const page = createPage(tree, {
      main: parentSession,
      child: childSession,
    });

    await expect(resolveXpathForLocation(page, 100, 120)).resolves.toStrictEqual({
      frameId: "child",
      backendNodeId: 200,
      absoluteXPath: "/html/body/iframe/html/body/button",
    });
    expect(parentSend).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "iframe-bounds",
    });
    expect(parentSend).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "iframe-xpath",
    });
    expect(childSend).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "child-node",
    });
  });

  it("returns null when the coordinate lookup fails", async () => {
    waitForMainWorld.mockResolvedValue(undefined);
    const { session } = createSession((method) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { sx: 0, sy: 0 } } };
      }
      if (method === "DOM.getNodeForLocation") {
        throw new Error("CDP lookup failed");
      }
      return {};
    });
    const page = createPage(frameTree("main"), { main: session });

    await expect(resolveXpathForLocation(page, 10, 20)).resolves.toBeNull();
  });
});
