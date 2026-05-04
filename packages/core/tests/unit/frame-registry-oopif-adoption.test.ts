import { describe, expect, it } from "vitest";
import type { Protocol } from "devtools-protocol";

import { FrameRegistry } from "../../lib/v3/understudy/frameRegistry.js";

describe("FrameRegistry OOPIF adoption ordering", () => {
  it("keeps child-session ownership when parent frameAttached arrives before child target adoption", () => {
    const registry = new FrameRegistry("target-1", "root-frame");

    registry.onFrameAttached("child-frame", "root-frame", "parent-session");
    registry.adoptChildSession("child-session", "child-frame");

    expect(registry.listAllFrames()).toEqual(["root-frame", "child-frame"]);
    expect(registry.getParent("child-frame")).toBe("root-frame");
    expect(registry.getOwnerSessionId("child-frame")).toBe("child-session");
    expect(registry.framesForSession("parent-session")).toEqual([]);
    expect(registry.framesForSession("child-session")).toEqual(["child-frame"]);
  });

  it("keeps child-session ownership when child target adoption is staged before parent frameAttached", () => {
    const registry = new FrameRegistry("target-1", "root-frame");

    registry.adoptChildSession("child-session", "child-frame");
    registry.onFrameAttached("child-frame", "root-frame", "parent-session");
    registry.adoptChildSession("child-session", "child-frame");

    expect(registry.listAllFrames()).toEqual(["root-frame", "child-frame"]);
    expect(registry.getParent("child-frame")).toBe("root-frame");
    expect(registry.getOwnerSessionId("child-frame")).toBe("child-session");
    expect(registry.framesForSession("parent-session")).toEqual([]);
    expect(registry.framesForSession("child-session")).toEqual(["child-frame"]);
  });

  it("preserves the known parent edge when seeding an adopted OOPIF child frame tree", () => {
    const registry = new FrameRegistry("target-1", "root-frame");

    registry.onFrameAttached("child-frame", "root-frame", "parent-session");
    registry.adoptChildSession("child-session", "child-frame");
    registry.seedFromFrameTree("child-session", {
      frame: {
        id: "child-frame",
        loaderId: "loader-1",
        name: "payment-frame",
        url: "https://js.stripe.com/v3/elements-inner-payment.html",
        domainAndRegistry: "stripe.com",
        securityOrigin: "https://js.stripe.com",
        mimeType: "text/html",
        secureContextType: "Secure",
        crossOriginIsolatedContextType: "NotIsolated",
        gatedAPIFeatures: [],
      },
    } satisfies Protocol.Page.FrameTree);

    expect(registry.getParent("child-frame")).toBe("root-frame");
    expect(registry.asProtocolFrameTree("root-frame")).toMatchObject({
      frame: { id: "root-frame" },
      childFrames: [
        {
          frame: {
            id: "child-frame",
            parentId: "root-frame",
            url: "https://js.stripe.com/v3/elements-inner-payment.html",
          },
        },
      ],
    });
  });
});
