import { describe, expect, it, vi } from "vitest";
import { ActionTargetMismatchError } from "../actionTarget.js";
import { Locator } from "../understudy/locator.js";
import type { Frame } from "../understudy/frame.js";

const { resolveAtIndex } = vi.hoisted(() => ({ resolveAtIndex: vi.fn() }));

vi.mock("../understudy/selectorResolver.js", () => ({
  FrameSelectorResolver: class {
    static parseSelector(selector: string) {
      return selector;
    }

    resolveAtIndex = resolveAtIndex;
  },
}));

vi.mock("../understudy/executionContextRegistry.js", () => ({
  executionContexts: {
    waitForLocatorWorld: vi.fn(async () => ({ contextId: 7 })),
  },
}));

describe("locator target guard", () => {
  it("validates and mutates the same resolved object", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-12" });
    const send = sessionSendForNode(12, 12);
    const locator = new Locator(
      frameWithSession(send, 12),
      "xpath=/html/body/button",
    ).withTargetGuard({ frameOrdinal: 0, backendNodeId: 12 }, 0);

    await locator.click();

    expect(send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-12" });
    expect(send).toHaveBeenCalledWith("DOM.getBoxModel", { objectId: "object-12" });
    expect(send).toHaveBeenCalledWith("DOM.resolveNode", {
      backendNodeId: 12,
      executionContextId: 7,
    });
    expect(send).toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });

  it("rejects a replacement before dispatching input", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-99" });
    const send = sessionSendForNode(99, 99);
    const locator = new Locator(
      frameWithSession(send, 99),
      "xpath=/html/body/button",
    ).withTargetGuard({ frameOrdinal: 0, backendNodeId: 12 }, 0);

    await expect(locator.click()).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(send).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });

  it("rejects when the hit-tested node under the cursor differs after geometry", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-12" });
    const send = sessionSendForNode(12, 99);
    const locator = new Locator(
      frameWithSession(send, 99),
      "xpath=/html/body/button",
    ).withTargetGuard({ frameOrdinal: 0, backendNodeId: 12 }, 0);

    await expect(locator.click()).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(send).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });

  it("rejects guarded centroid when the hit-tested node differs", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-12" });
    const send = sessionSendForNode(12, 99);
    const locator = new Locator(
      frameWithSession(send, 99),
      "xpath=/html/body/button",
    ).withTargetGuard({ frameOrdinal: 0, backendNodeId: 12 }, 0);

    await expect(locator.centroid()).rejects.toBeInstanceOf(ActionTargetMismatchError);
  });
});

function frameWithSession(send: ReturnType<typeof vi.fn>, hitBackendNodeId: number): Frame {
  return {
    frameId: "frame-1",
    session: { send },
    getNodeAtLocation: vi.fn(async () => ({ backendNodeId: hitBackendNodeId })),
  } as unknown as Frame;
}

function sessionSendForNode(resolvedBackendNodeId: number, hitBackendNodeId: number) {
  return vi.fn(async (method: string) => {
    if (method === "DOM.describeNode") return { node: { backendNodeId: resolvedBackendNodeId } };
    if (method === "DOM.getBoxModel") {
      return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } };
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: `hit-${hitBackendNodeId}` } };
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: hitBackendNodeId === resolvedBackendNodeId } };
    }
    return {};
  });
}
