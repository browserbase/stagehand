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
      vi.setSystemTime(1_200);
      throw readinessError;
    });
    const { locator } = createFrameLocator(session, () => session);

    await expect(locator.resolveFrame()).rejects.toBe(readinessError);
  });

  it("stops retrying at the readiness budget and preserves the last error", async () => {
    const session = createSession("session-a");
    const initialError = new Error("Locator world is still initializing");
    const lastError = new Error("Stagehand extension world not ready for frame child");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waitForLocatorWorld = vi
      .spyOn(executionContexts, "waitForLocatorWorld")
      .mockImplementation(async (_session, _frameId, timeout) => {
        // Simulate attempts that overrun their requested slice, as fallback can.
        vi.setSystemTime(Date.now() + timeout! + 50);
        throw Date.now() >= 1_200 ? lastError : initialError;
      });
    const { locator } = createFrameLocator(session, () => session);

    await expect(locator.resolveFrame()).rejects.toBe(lastError);
    expect(waitForLocatorWorld.mock.calls.map((call) => call[2])).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(Date.now()).toBe(1_250);
  });

  it("caps the final readiness attempt to the remaining budget", async () => {
    const session = createSession("session-a");
    const readinessError = new Error("Stagehand extension world not ready for frame child");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waitForLocatorWorld = vi
      .spyOn(executionContexts, "waitForLocatorWorld")
      .mockImplementation(async (_session, _frameId, timeout) => {
        vi.setSystemTime(Date.now() === 0 ? 1_100 : Date.now() + timeout!);
        throw readinessError;
      });
    const { locator } = createFrameLocator(session, () => session);

    await expect(locator.resolveFrame()).rejects.toBe(readinessError);
    expect(waitForLocatorWorld.mock.calls.map((call) => call[2])).toEqual([200, 100]);
    expect(Date.now()).toBe(1_200);
  });

  it("returns immediately when the locator world is already ready", async () => {
    const session = createSession("session-a");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waitForLocatorWorld = vi
      .spyOn(executionContexts, "waitForLocatorWorld")
      .mockResolvedValue({
        kind: "extension",
        contextId: 1,
        capabilities: { closedShadowRoots: true },
      });
    const { locator, childFrame } = createFrameLocator(session, () => session);

    await expect(locator.resolveFrame()).resolves.toBe(childFrame);
    expect(waitForLocatorWorld).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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
