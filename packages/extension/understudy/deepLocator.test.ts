import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
import { Locator } from "./locator.js";
import { Progress, runWithProgress } from "./progress.js";
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

      await runWithProgress({ name: "resolve", timeout: 100 }, async (progress) => {
        const locator = await delegate.nth(1).real(progress);
        expect(locator.getFrame()).toBe(inner);
        expect(locator.nthIndex).toBe(1);
        await expect(locator.resolveNode(progress)).resolves.toEqual({
          objectId: "node",
          nodeId: 1,
        });
        expect(resolveFrame.mock.calls).toEqual([[progress], [progress]]);
        const calls = lookups.flatMap((lookup) => lookup.mock.calls);
        expect(calls).toHaveLength(3);
        expect(calls.every(([, , context]) => context === progress)).toBe(true);
        expect(progress.remainingMs()).toBe(100);
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects an expired context before resolving a target or sending commands", async () => {
    vi.useFakeTimers();
    const { page, root, send } = createFrames();
    const progress = new Progress("resolve", 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(new DeepLocatorDelegate(page, root, "#target").real(progress)).rejects.toBe(
      progress.signal.reason,
    );
    await expect(frameLocatorFromFrame(page, root, "#outer").resolveFrame(progress)).rejects.toBe(
      progress.signal.reason,
    );
    await expect(root.locator("#target").resolveNode(progress)).rejects.toBe(
      progress.signal.reason,
    );
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("structured selector dispatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { type: "css" as const, value: '[data-label="a >> b"]' },
    { type: "xpath" as const, value: './/button[@title="text=Pay"]' },
    { type: "text" as const, value: 'text="Pay" >> now' },
  ])("resolves explicit $type selectors without legacy interpretation", async (selector) => {
    const frame = { session: { send: vi.fn() } } as unknown as Frame;
    const parseLegacy = vi.spyOn(FrameLocator.prototype, "resolveFrame");
    const delegate = new DeepLocatorDelegate({} as Page, frame, selector).nth(2);
    const locator = await delegate.real();

    expect(locator.frame).toBe(frame);
    expect(locator.selectorQuery).toEqual({ kind: selector.type, value: selector.value });
    expect(locator.nthIndex).toBe(2);
    expect(parseLegacy).not.toHaveBeenCalled();
  });

  it("retains iframe hops and prefix parsing for legacy selectors", async () => {
    const root = { session: { send: vi.fn() } } as unknown as Frame;
    const child = { session: { send: vi.fn() } } as unknown as Frame;
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame").mockResolvedValue(child);
    const delegate = new DeepLocatorDelegate({} as Page, root, {
      type: "legacy",
      value: 'iframe#checkout >> text="Pay"',
    });

    const locator = await delegate.real();

    expect(resolveFrame).toHaveBeenCalledOnce();
    expect(locator.frame).toBe(child);
    expect(locator.selectorQuery).toEqual({ kind: "text", value: "Pay" });
  });
});
