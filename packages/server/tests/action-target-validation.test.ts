import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import {
  ActionTargetMismatchError,
  performUnderstudyMethod,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger } from "../logger.js";
import type { Frame } from "../understudy/frame.js";
import type { Locator } from "../understudy/locator.js";
import type { Page } from "../understudy/page.js";

vi.mock("../understudy/deepLocator.js", () => ({
  resolveLocatorWithHops: vi.fn(),
}));

const resolveLocator = vi.mocked(resolveLocatorWithHops);

describe("action target validation", () => {
  const logger = new StagehandLogger(
    { tracer: trace.getTracer("action-target-validation-test") },
    () => {},
  );

  beforeEach(() => {
    resolveLocator.mockReset();
  });

  it("blocks the action handler when the selector resolves to a different node", async () => {
    const click = vi.fn();
    resolveLocator.mockResolvedValue(locatorForNode(0, 20, click));

    await expect(
      performUnderstudyMethod(
        pageWithOrdinals(),
        rootFrame(),
        "click",
        "xpath=/html/body/button[1]",
        [],
        logger,
        undefined,
        { target: { frameOrdinal: 0, backendNodeId: 12 } },
      ),
    ).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(click).not.toHaveBeenCalled();
  });

  it("executes the action handler when the observed target still matches", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    resolveLocator.mockResolvedValue(locatorForNode(0, 12, click));

    await performUnderstudyMethod(
      pageWithOrdinals(),
      rootFrame(),
      "click",
      "xpath=/html/body/button[1]",
      [],
      logger,
      undefined,
      { target: { frameOrdinal: 0, backendNodeId: 12 } },
    );

    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps legacy actions without target metadata working", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const readBackendNodeId = vi.fn(async () => 20);
    const locator = locatorForNode(0, 20, click, readBackendNodeId);
    resolveLocator.mockResolvedValue(locator);

    await performUnderstudyMethod(
      pageWithOrdinals(),
      rootFrame(),
      "click",
      "xpath=/html/body/button[1]",
      [],
      logger,
    );

    expect(readBackendNodeId).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it("blocks drag-and-drop when the destination resolves to a different node", async () => {
    const dragAndDrop = vi.fn();
    const page = pageWithOrdinals(dragAndDrop);
    resolveLocator
      .mockResolvedValueOnce(locatorForNode(0, 12, vi.fn()))
      .mockResolvedValueOnce(locatorForNode(0, 99, vi.fn()));

    await expect(
      performUnderstudyMethod(
        page,
        rootFrame(),
        "dragAndDrop",
        "xpath=/html/body/source",
        ["xpath=/html/body/destination"],
        logger,
        undefined,
        {
          target: { frameOrdinal: 0, backendNodeId: 12 },
          argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
        },
      ),
    ).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(dragAndDrop).not.toHaveBeenCalled();
  });

  it("blocks drag-and-drop when a replacement appears under the drop point before dispatch", async () => {
    const dragAndDrop = vi.fn();
    const page = pageWithOrdinals(dragAndDrop);
    const source = locatorForNode(0, 12, vi.fn());
    const destination = locatorForNode(0, 20, vi.fn());
    const guardedDestination = destination.withTargetGuard(
      { frameOrdinal: 0, backendNodeId: 20 },
      0,
    );
    guardedDestination.assertPointerTargetAt = async () => {
      throw new ActionTargetMismatchError(
        { frameOrdinal: 0, backendNodeId: 20 },
        { frameOrdinal: 0, backendNodeId: 99 },
      );
    };
    destination.withTargetGuard = () => guardedDestination;
    resolveLocator.mockResolvedValueOnce(source).mockResolvedValueOnce(destination);

    await expect(
      performUnderstudyMethod(
        page,
        rootFrame(),
        "dragAndDrop",
        "xpath=/html/body/source",
        ["xpath=/html/body/destination"],
        logger,
        undefined,
        {
          target: { frameOrdinal: 0, backendNodeId: 12 },
          argumentTargets: { "0": { frameOrdinal: 0, backendNodeId: 20 } },
        },
      ),
    ).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(dragAndDrop).not.toHaveBeenCalled();
  });

  it("resolves the guarded locator before press so stale targets fail closed", async () => {
    const resolveNode = vi.fn(async () => {
      throw new ActionTargetMismatchError(
        { frameOrdinal: 0, backendNodeId: 12 },
        { frameOrdinal: 0, backendNodeId: 99 },
      );
    });
    const keyPress = vi.fn();
    resolveLocator.mockResolvedValue(
      locatorForNode(
        0,
        99,
        vi.fn(),
        vi.fn(async () => 99),
        resolveNode,
      ),
    );

    await expect(
      performUnderstudyMethod(
        Object.assign(pageWithOrdinals(), { keyPress }) as unknown as Page,
        rootFrame(),
        "press",
        "xpath=/html/body/input",
        ["Enter"],
        logger,
        undefined,
        { target: { frameOrdinal: 0, backendNodeId: 12 } },
      ),
    ).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(keyPress).not.toHaveBeenCalled();
  });

  it("keeps targetless press on the focused element without resolving the locator", async () => {
    const resolveNode = vi.fn(async () => {
      throw new Error("should not resolve for targetless press");
    });
    const keyPress = vi.fn();
    resolveLocator.mockResolvedValue(
      locatorForNode(
        0,
        99,
        vi.fn(),
        vi.fn(async () => 99),
        resolveNode,
      ),
    );

    await performUnderstudyMethod(
      Object.assign(pageWithOrdinals(), { keyPress }) as unknown as Page,
      rootFrame(),
      "press",
      "xpath=/html/body/stale",
      ["Enter"],
      logger,
    );

    expect(resolveNode).not.toHaveBeenCalled();
    expect(keyPress).toHaveBeenCalledWith("Enter");
  });

  it("resolves the guarded locator before mouse.wheel so stale targets fail closed", async () => {
    const resolveNode = vi.fn(async () => {
      throw new ActionTargetMismatchError(
        { frameOrdinal: 0, backendNodeId: 12 },
        { frameOrdinal: 0, backendNodeId: 99 },
      );
    });
    const send = vi.fn(async () => ({}));
    resolveLocator.mockResolvedValue(
      locatorForNode(
        0,
        99,
        vi.fn(),
        vi.fn(async () => 99),
        resolveNode,
      ),
    );

    await expect(
      performUnderstudyMethod(
        pageWithOrdinals(),
        { ...rootFrame(), session: { send } } as unknown as Frame,
        "mouse.wheel",
        "xpath=/html/body/scrollable",
        ["200"],
        logger,
        undefined,
        { target: { frameOrdinal: 0, backendNodeId: 12 } },
      ),
    ).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(send).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });

  it("keeps targetless mouse.wheel on the page without resolving the locator", async () => {
    const resolveNode = vi.fn(async () => {
      throw new Error("should not resolve for targetless mouse.wheel");
    });
    const send = vi.fn(async () => ({}));
    resolveLocator.mockResolvedValue(
      locatorForNode(
        0,
        99,
        vi.fn(),
        vi.fn(async () => 99),
        resolveNode,
      ),
    );

    await performUnderstudyMethod(
      pageWithOrdinals(),
      { ...rootFrame(), session: { send } } as unknown as Frame,
      "mouse.wheel",
      "xpath=/html/body/stale",
      ["200"],
      logger,
    );

    expect(resolveNode).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({
        type: "mouseWheel",
        x: 0,
        y: 0,
        deltaY: 200,
        deltaX: 0,
      }),
    );
  });
});

function rootFrame(): Frame {
  return {
    frameId: "root-frame",
    evaluate: vi.fn(async () => "https://example.test"),
  } as unknown as Frame;
}

function pageWithOrdinals(dragAndDrop: ReturnType<typeof vi.fn> = vi.fn()): Page {
  return {
    getOrdinal: (frameId: string) => (frameId === "target-frame" ? 0 : 1),
    dragAndDrop,
  } as unknown as Page;
}

function locatorForNode(
  frameOrdinal: number,
  backendNodeId: number,
  click: () => unknown,
  readBackendNodeId: () => Promise<number> = vi.fn(async () => backendNodeId),
  resolveNode: () => Promise<{ objectId: string }> = vi.fn(async () => ({
    objectId: `object-${backendNodeId}`,
  })),
): Locator {
  const frame = {
    frameId: frameOrdinal === 0 ? "target-frame" : `target-frame-${frameOrdinal}`,
    evaluate: vi.fn(async (_fn: unknown, value: unknown) => value),
    session: {
      send: vi.fn(async () => ({})),
    },
  } as unknown as Frame;
  const centroid = vi.fn(async () => ({ x: 10, y: 20 }));
  const validate = async (expected: { frameOrdinal: number; backendNodeId: number }) => {
    const actual = {
      frameOrdinal,
      backendNodeId: await readBackendNodeId(),
    };
    if (
      actual.frameOrdinal !== expected.frameOrdinal ||
      actual.backendNodeId !== expected.backendNodeId
    ) {
      throw new ActionTargetMismatchError(expected, actual);
    }
  };
  const locator = {
    getFrame: () => frame,
    backendNodeId: readBackendNodeId,
    resolveNode,
    click,
    centroid,
    assertPointerTargetAt: vi.fn(async () => undefined),
    withTargetGuard: (
      expected: { frameOrdinal: number; backendNodeId: number },
      frameOrdinal: number = expected.frameOrdinal,
    ) => ({
      ...locator,
      targetGuard: { expected, frameOrdinal },
      resolveNode: async () => {
        await validate(expected);
        return await resolveNode();
      },
      click: async () => {
        await validate(expected);
        await click();
      },
      centroid: async () => {
        await validate(expected);
        return await centroid();
      },
      assertPointerTargetAt: async () => {
        await validate(expected);
      },
    }),
  };
  return locator as unknown as Locator;
}
