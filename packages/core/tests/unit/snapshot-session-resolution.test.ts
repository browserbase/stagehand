import type { Protocol } from "devtools-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvedOwnerSession } from "../../lib/v3/understudy/a11y/snapshot/sessions.js";
import type { CDPSessionLike } from "../../lib/v3/understudy/cdp.js";
import type { Page } from "../../lib/v3/understudy/page.js";

function createFrameTree(
  rootId: string,
  childIds: string[] = [],
): Protocol.Page.FrameTree {
  return {
    frame: {
      id: rootId,
      loaderId: `loader-${rootId}`,
      url: `https://${rootId}.example.com`,
      domainAndRegistry: "",
      securityOrigin: `https://${rootId}.example.com`,
      mimeType: "text/html",
      secureContextType: "Secure",
      crossOriginIsolatedContextType: "NotIsolated",
      gatedAPIFeatures: [],
    },
    childFrames: childIds.map((id) => createFrameTree(id)),
  };
}

function createSession(
  id: string,
  frameTree: Protocol.Page.FrameTree,
): CDPSessionLike {
  return {
    id,
    send: async (method: string) => {
      if (method === "Page.enable") return {};
      if (method === "Page.getFrameTree") return { frameTree };
      throw new Error(`Unexpected method ${method}`);
    },
    on: (): void => undefined,
    off: (): void => undefined,
  } as unknown as CDPSessionLike;
}

describe("resolvedOwnerSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the session whose frame tree reaches the target at the shallowest depth", async () => {
    const staleSession = createSession(
      "stale-session",
      createFrameTree("main", ["child-frame"]),
    );
    const liveSession = createSession(
      "live-session",
      createFrameTree("child-frame"),
    );

    const page = {
      getSessionForFrame: () => staleSession,
      allSessions: () => [staleSession, liveSession],
    } as unknown as Page;

    const resolved = await resolvedOwnerSession(page, "child-frame");
    expect(resolved).toBe(liveSession);
  });

  it("skips sessions whose frame-tree probe times out", async () => {
    vi.useFakeTimers();

    const hangingSession = {
      id: "hanging-session",
      send: async () => await new Promise(() => undefined),
      on: (): void => undefined,
      off: (): void => undefined,
    } as unknown as CDPSessionLike;

    const liveSession = createSession(
      "live-session",
      createFrameTree("child-frame"),
    );

    const page = {
      getSessionForFrame: () => hangingSession,
      allSessions: () => [hangingSession, liveSession],
    } as unknown as Page;

    const pending = resolvedOwnerSession(page, "child-frame");
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toBe(liveSession);
  });
});
