import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { resolveLocatorWithHops } from "./selectorTarget.js";
import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { FrameLocator, frameLocatorFromFrame } from "./frameLocator.js";
import { Locator } from "./locator.js";
import { Progress, runWithProgress } from "./progress.js";
import { FrameSelectorResolver } from "./selectorResolver.js";
import { executionContexts } from "./executionContextRegistry.js";

describe("DeepLocatorDelegate match selection", () => {
  afterEach(() => vi.restoreAllMocks());

  function createDelegate(nth?: number) {
    const send = vi.fn(async (method: string, params: Record<string, unknown>) =>
      method === "DOM.describeNode"
        ? { node: { backendNodeId: Number(params.objectId), localName: "button" } }
        : {},
    );
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([
      { objectId: "1", nodeId: null },
      { objectId: "2", nodeId: null },
    ]);
    const chain: LocatorChain = {
      steps: [
        {
          type: "query",
          selector: { type: "css", value: ".item" },
          ...(nth === undefined ? {} : { nth }),
        },
      ],
    };
    return new DeepLocatorDelegate({} as Page, frame, chain);
  }

  it("preserves all matches for count and masks and selects the first for actions", async () => {
    const delegate = createDelegate();
    expect(await delegate.count()).toBe(2);
    const progress = new Progress("mask", 1000);
    try {
      expect(await delegate.allForMask(progress)).toHaveLength(2);
    } finally {
      progress.dispose();
    }
    const locator = await delegate.real();
    expect(locator).toMatchObject({ backendId: 1 });
  });

  it("applies the final step index for all operations", async () => {
    const delegate = createDelegate(1);
    expect(await delegate.count()).toBe(1);
    expect(await delegate.real()).toMatchObject({ backendId: 2 });
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
      await runWithProgress({ name: "resolve", timeout: 100 }, async (progress) => {
        const locator =
          kind === "frame locator"
            ? await frameLocatorFromFrame(page, root, "#outer")
                .frameLocator("#inner")
                .locator("text=target")
                .nth(1)
                .real(progress)
            : (
                await resolveLocatorWithHops(
                  page,
                  root,
                  kind === "hops"
                    ? "#outer >> #inner >> #target"
                    : "xpath=/html/iframe/html/iframe/html/button",
                  progress,
                )
              ).nth(1);
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

    await expect(
      new DeepLocatorDelegate(page, root, {
        steps: [{ type: "query", selector: { type: "css", value: "#target" } }],
      }).real(progress),
    ).rejects.toBe(progress.signal.reason);
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
  ])("passes $type query values directly to the engine", async (selector) => {
    const frame = { frameId: "root", session: { send: vi.fn() } } as unknown as Frame;
    const resolve = vi.spyOn(FrameSelectorResolver.prototype, "resolveAll").mockResolvedValue([]);
    const delegate = new DeepLocatorDelegate({} as Page, frame, {
      steps: [{ type: "query", selector }],
    });
    expect(await delegate.count()).toBe(0);
    expect(resolve).toHaveBeenCalledWith(
      { kind: selector.type, value: selector.value },
      {},
      undefined,
    );
  });
});
