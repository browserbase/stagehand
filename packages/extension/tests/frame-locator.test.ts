import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import type { Frame } from "../understudy/frame.js";
import { FrameLocator } from "../understudy/frameLocator.js";
import type { Page } from "../understudy/page.js";

function createSession(id: string): CDPSessionLike {
  const send = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "DOM.describeNode") return { node: { backendNodeId: 1 } };
    if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
    return {};
  });
  return {
    id,
    send: send as CDPSessionLike["send"],
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
  };
}

function createFrameLocator(
  initialSession: CDPSessionLike,
  getSessionForFrame: () => CDPSessionLike,
): { locator: FrameLocator; childFrame: Frame } {
  const childFrame = { frameId: "child" } as Frame;
  const root = {
    frameId: "parent",
    session: initialSession,
    locator: () => ({
      resolveNode: async () => ({ objectId: "iframe-object" }),
    }),
  } as unknown as Frame;
  const page = {
    getFullFrameTree: () => ({
      frame: { id: "parent" },
      childFrames: [{ frame: { id: "child" } }],
    }),
    getSessionForFrame,
    frameForId: () => childFrame,
  } as unknown as Page;

  return {
    locator: new FrameLocator(page, "xpath=/html/body/iframe[1]", undefined, root),
    childFrame,
  };
}

describe("FrameLocator readiness", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("propagates readiness failures after finding the matching child frame", async () => {
    const session = createSession("session-a");
    const readinessError = new Error("Stagehand extension world not ready for frame child");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockImplementation(async () => {
      vi.setSystemTime(15_000);
      throw readinessError;
    });
    const { locator } = createFrameLocator(session, () => session);

    await expect(locator.resolveFrame()).rejects.toBe(readinessError);
  });

  it("retries readiness when OOPIF ownership changes during an attempt", async () => {
    const oldSession = createSession("session-a");
    const adoptedSession = createSession("session-b");
    const getSessionForFrame = vi
      .fn<() => CDPSessionLike>()
      .mockReturnValueOnce(oldSession)
      .mockReturnValue(adoptedSession);
    const waitForLocatorWorld = vi
      .spyOn(executionContexts, "waitForLocatorWorld")
      .mockResolvedValue({
        kind: "extension",
        contextId: 1,
        capabilities: { closedShadowRoots: true },
      });
    const { locator, childFrame } = createFrameLocator(oldSession, getSessionForFrame);

    await expect(locator.resolveFrame()).resolves.toBe(childFrame);
    expect(waitForLocatorWorld).toHaveBeenNthCalledWith(1, oldSession, "child", 200);
    expect(waitForLocatorWorld).toHaveBeenNthCalledWith(2, adoptedSession, "child", 200);
  });
});
