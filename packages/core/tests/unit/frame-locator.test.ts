import { describe, expect, it, vi } from "vitest";
import { FrameLocator } from "../../lib/v3/understudy/frameLocator.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import { executionContexts } from "../../lib/v3/understudy/executionContextRegistry.js";

describe("FrameLocator.resolveFrame", () => {
  it("prefers the frameId returned by DOM.describeNode for iframe owners", async () => {
    const parentSession = new MockCDPSession({
      "DOM.enable": async () => ({}),
      "DOM.describeNode": async () => ({
        node: {
          backendNodeId: 123,
          frameId: "child-frame",
        },
      }),
      "Runtime.releaseObject": async () => ({}),
    });

    const parentFrame = {
      frameId: "parent-frame",
      session: parentSession,
      locator: () => ({
        resolveNode: async () => ({ objectId: "iframe-object" }),
      }),
    };

    const childFrame = {
      frameId: "child-frame",
      session: parentSession,
    };

    const page = {
      mainFrame: () => parentFrame,
      frameForId: (frameId: string) => {
        expect(frameId).toBe("child-frame");
        return childFrame;
      },
      frameForIdWithSession: (frameId: string) => {
        expect(frameId).toBe("child-frame");
        return childFrame;
      },
      getSessionForFrame: () => parentSession,
      getKnownSessionForFrame: () => parentSession,
    };

    const getMainWorldSpy = vi
      .spyOn(executionContexts, "getMainWorld")
      .mockReturnValue(1 as never);

    const frameLocator = new FrameLocator(
      page as never,
      'iframe[title="Field container for: Card number"]',
    );

    await expect(frameLocator.resolveFrame()).resolves.toBe(childFrame);
    expect(parentSession.callsFor("Page.getFrameTree")).toHaveLength(0);
    expect(parentSession.callsFor("DOM.getFrameOwner")).toHaveLength(0);

    getMainWorldSpy.mockRestore();
  });
});
