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

describe("locator target guard", () => {
  it("validates and mutates the same resolved object", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-12" });
    const send = sessionSendForNode(12);
    const locator = new Locator(frameWithSession(send), "xpath=/html/body/button").withTargetGuard(
      { frameOrdinal: 0, backendNodeId: 12 },
      0,
    );

    await locator.click();

    expect(send).toHaveBeenCalledWith("DOM.describeNode", { objectId: "object-12" });
    expect(send).toHaveBeenCalledWith("DOM.getBoxModel", { objectId: "object-12" });
  });

  it("rejects a replacement before dispatching input", async () => {
    resolveAtIndex.mockResolvedValueOnce({ nodeId: null, objectId: "object-99" });
    const send = sessionSendForNode(99);
    const locator = new Locator(frameWithSession(send), "xpath=/html/body/button").withTargetGuard(
      { frameOrdinal: 0, backendNodeId: 12 },
      0,
    );

    await expect(locator.click()).rejects.toBeInstanceOf(ActionTargetMismatchError);

    expect(send).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });
});

function frameWithSession(send: ReturnType<typeof vi.fn>): Frame {
  return { session: { send } } as unknown as Frame;
}

function sessionSendForNode(backendNodeId: number) {
  return vi.fn(async (method: string) => {
    if (method === "DOM.describeNode") return { node: { backendNodeId } };
    if (method === "DOM.getBoxModel") {
      return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } };
    }
    return {};
  });
}
