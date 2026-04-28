import { describe, expect, it } from "vitest";
import { FrameRegistry } from "../../lib/v3/understudy/frameRegistry.js";

describe("FrameRegistry.seedFromFrameTree", () => {
  it("re-owns an adopted child session subtree even if the parent saw it first", () => {
    const registry = new FrameRegistry("page-target", "main");

    registry.onFrameAttached("child-root", "main", "parent-session");
    registry.onFrameAttached("grandchild", "child-root", "parent-session");

    expect(registry.getOwnerSessionId("child-root")).toBe("parent-session");
    expect(registry.getOwnerSessionId("grandchild")).toBe("parent-session");

    registry.adoptChildSession("child-session", "child-root");
    registry.seedFromFrameTree("child-session", {
      frame: {
        id: "child-root",
        loaderId: "loader-1",
        url: "https://child.example",
        domainAndRegistry: "",
        securityOrigin: "https://child.example",
        mimeType: "text/html",
        secureContextType: "Secure",
        crossOriginIsolatedContextType: "NotIsolated",
        gatedAPIFeatures: [],
      },
      childFrames: [
        {
          frame: {
            id: "grandchild",
            parentId: "child-root",
            loaderId: "loader-2",
            url: "https://grandchild.example",
            domainAndRegistry: "",
            securityOrigin: "https://grandchild.example",
            mimeType: "text/html",
            secureContextType: "Secure",
            crossOriginIsolatedContextType: "NotIsolated",
            gatedAPIFeatures: [],
          },
        },
      ],
    });

    expect(registry.getOwnerSessionId("child-root")).toBe("child-session");
    expect(registry.getOwnerSessionId("grandchild")).toBe("child-session");
  });

  it("prunes swap-detached subframes but preserves root swaps", () => {
    const registry = new FrameRegistry("page-target", "main");

    registry.onFrameAttached("child-root", "main", "parent-session");
    registry.onFrameAttached("grandchild", "child-root", "parent-session");

    registry.onFrameDetached("child-root", "swap");

    expect(registry.getOwnerSessionId("child-root")).toBeUndefined();
    expect(registry.getOwnerSessionId("grandchild")).toBeUndefined();
    expect(registry.listAllFrames()).toEqual(["main"]);

    registry.onFrameDetached("main", "swap");

    expect(registry.listAllFrames()).toEqual(["main"]);
  });
});
