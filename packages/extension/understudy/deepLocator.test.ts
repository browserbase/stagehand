import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
import { Locator } from "./locator.js";
import { LocatorOperation, runLocatorOperation } from "./locatorOperation.js";
import { FrameSelectorResolver } from "./selectorResolver.js";
import { executionContexts } from "./executionContextRegistry.js";

describe("DeepLocatorDelegate match selection", () => {
  const createDelegate = () => {
    const send = vi.fn().mockResolvedValue({});
    const frame = { session: { send } } as unknown as Frame;
    return { delegate: new DeepLocatorDelegate({} as Page, frame, ".item"), send };
  };

  it("preserves all matches by default and narrows explicit nth() locators", async () => {
    const { delegate } = createDelegate();

    await expect(delegate.real()).resolves.toMatchObject({ nthIndex: -1 });
    await expect(delegate.nth(2).real()).resolves.toMatchObject({ nthIndex: 2 });
    await expect(delegate.first().real()).resolves.toMatchObject({ nthIndex: 0 });
  });

  it("uses the first match for a default single-element resolution", async () => {
    const { delegate } = createDelegate();
    const locator = await delegate.real();
    const resolveAtIndex = vi
      .spyOn(locator.selectorResolver, "resolveAtIndex")
      .mockResolvedValue({ objectId: "node-1", nodeId: null });

    await expect(locator.resolveNode()).resolves.toEqual({ objectId: "node-1", nodeId: null });
    expect(resolveAtIndex).toHaveBeenCalledWith(locator.selectorQuery, 0, undefined);
  });
});

describe("locator resolution contexts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createFrames() {
    const send = vi.fn(async (method: string) => {
      if (method === "DOM.describeNode") return { node: { backendNodeId: 1 } };
      if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
      if (method === "Runtime.evaluate") return { result: { objectId: "node" } };
      if (method === "DOM.requestNode") return { nodeId: 1 };
      return {};
    });
    const frames = ["root", "middle", "inner"].map((frameId) => {
      const frame = {
        frameId,
        session: { send },
        locator: (selector: string) => new Locator(frame, selector),
      } as unknown as Frame;
      return frame;
    });
    const [root, middle, inner] = frames;
    const page = {
      getFullFrameTree: () => ({
        frame: { id: root.frameId },
        childFrames: [
          {
            frame: { id: middle.frameId },
            childFrames: [{ frame: { id: inner.frameId } }],
          },
        ],
      }),
      getSessionForFrame: () => root.session,
      frameForId: (id: string) => frames.find((frame) => frame.frameId === id),
    } as unknown as Page;
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      kind: "extension",
      contextId: 1,
      capabilities: { closedShadowRoots: true },
    });
    return { page, root, inner, send };
  }

  it.each(["hops", "xpath", "frame locator"] as const)(
    "passes one context through nested %s resolution & preserves nth()",
    async (kind) => {
      vi.useFakeTimers();
      const { page, root, inner } = createFrames();
      const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame");
      const lookups = (["resolveCss", "resolveText", "resolveXPath"] as const).map((method) =>
        vi.spyOn(FrameSelectorResolver.prototype, method),
      );
      const delegate =
        kind === "frame locator"
          ? frameLocatorFromFrame(page, root, "#outer")
              .frameLocator("#inner")
              .locator("text=target")
          : new DeepLocatorDelegate(
              page,
              root,
              kind === "hops"
                ? "#outer >> #inner >> #target"
                : "xpath=/html/iframe/html/iframe/html/button",
            );

      await runLocatorOperation({ name: "resolve", timeout: 100 }, async (operation) => {
        const locator = await delegate.nth(1).real(operation);
        expect(locator.getFrame()).toBe(inner);
        expect(locator.nthIndex).toBe(1);
        await expect(locator.resolveNode(operation)).resolves.toEqual({
          objectId: "node",
          nodeId: 1,
        });
        expect(resolveFrame.mock.calls).toEqual([[operation], [operation]]);
        const calls = lookups.flatMap((lookup) => lookup.mock.calls);
        expect(calls).toHaveLength(3);
        expect(calls.every(([, , context]) => context === operation)).toBe(true);
        expect(operation.remainingMs()).toBe(100);
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects an expired context before resolving a target or sending commands", async () => {
    vi.useFakeTimers();
    const { page, root, send } = createFrames();
    const operation = new LocatorOperation("resolve", 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(new DeepLocatorDelegate(page, root, "#target").real(operation)).rejects.toBe(
      operation.signal.reason,
    );
    await expect(frameLocatorFromFrame(page, root, "#outer").resolveFrame(operation)).rejects.toBe(
      operation.signal.reason,
    );
    await expect(root.locator("#target").resolveNode(operation)).rejects.toBe(
      operation.signal.reason,
    );
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
