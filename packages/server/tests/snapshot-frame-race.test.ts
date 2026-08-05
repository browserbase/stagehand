import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { Page } from "../understudy/page.js";
import { captureHybridSnapshot } from "../understudy/a11y/snapshot/capture.js";

describe("hybrid snapshot frame races", () => {
  it("omits a child that detaches after the frame topology is captured", async () => {
    const liveFrames = new Set(["root", "child"]);
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.getDocument") {
        return {
          root: {
            nodeId: 1,
            backendNodeId: 1,
            nodeType: 9,
            nodeName: "#document",
            localName: "",
            nodeValue: "",
            childNodeCount: 0,
            children: [],
          } satisfies Protocol.DOM.Node,
        };
      }

      if (method === "Accessibility.getFullAXTree") {
        if (params?.frameId === "root") {
          liveFrames.delete("child");
          return {
            nodes: [
              {
                nodeId: "1",
                ignored: false,
                role: { type: "role", value: "RootWebArea" },
                name: { type: "computedString", value: "Stable root" },
                backendDOMNodeId: 1,
              },
            ] satisfies Protocol.Accessibility.AXNode[],
          };
        }
        throw new Error("Frame with given id was not found");
      }

      if (method === "DOM.getFrameOwner") {
        throw new Error("Frame with given id was not found");
      }

      return {};
    });
    const session = { id: "root-session", send } as unknown as CDPSessionLike;
    const page = {
      logger: { warn: vi.fn() },
      mainFrameId: () => "root",
      asProtocolFrameTree: () => ({
        frame: protocolFrame("root"),
        childFrames: [{ frame: protocolFrame("child", "root") }],
      }),
      listAllFrameIds: () => ["root", "child"],
      hasFrame: (frameId: string) => liveFrames.has(frameId),
      getSessionForFrame: () => session,
      getOrdinal: (frameId: string) => (frameId === "root" ? 0 : 1),
      getOwnerBackendNodeId: () => undefined,
      setOwnerBackendNodeId: vi.fn(),
    } as unknown as Page;

    const snapshot = await captureHybridSnapshot(page);

    expect(snapshot.combinedTree).toContain("Stable root");
    expect(snapshot.perFrame?.map(({ frameId }) => frameId)).toStrictEqual(["root"]);
    expect(
      send.mock.calls.filter(([method]) => method === "Accessibility.getFullAXTree"),
    ).toHaveLength(1);
  });
});

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
