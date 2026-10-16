import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { performMediaControlMethod } from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger } from "../logger.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

function mediaFrame() {
  const send = vi.fn(async (method: string) =>
    method === "DOM.getBoxModel" ? { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } } : {},
  );
  const getSessionForFrame = vi.fn(() => ({ send }));
  return { page: { getSessionForFrame } as unknown as Page, send, getSessionForFrame };
}

async function perform(page: Page, method: string, args: string[] = []): Promise<void> {
  const progress = new Progress("act()", 0);
  try {
    await performMediaControlMethod(
      page,
      "frame-1",
      42,
      method,
      args,
      new StagehandLogger({ tracer: trace.getTracer("media-control-test") }, () => {}),
      progress,
    );
  } finally {
    progress.dispose();
  }
}

describe("performMediaControlMethod", () => {
  it("clicks the center of the control's own box on its frame's session", async () => {
    const { page, send, getSessionForFrame } = mediaFrame();

    await perform(page, "click", ["right"]);

    expect(getSessionForFrame).toHaveBeenCalledWith("frame-1");
    expect(send.mock.calls).toEqual([
      ["DOM.scrollIntoViewIfNeeded", { backendNodeId: 42 }],
      ["DOM.getBoxModel", { backendNodeId: 42 }],
      ["Input.dispatchMouseEvent", { type: "mouseMoved", button: "none", x: 20, y: 30 }],
      [
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "right", clickCount: 1, x: 20, y: 30 },
      ],
      [
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", button: "right", clickCount: 1, x: 20, y: 30 },
      ],
    ]);
  });

  it("double-clicks with two press and release pairs, and hovers with a move only", async () => {
    const doubleClick = mediaFrame();
    await perform(doubleClick.page, "doubleClick");
    expect(
      doubleClick.send.mock.calls
        .filter(([method]) => method === "Input.dispatchMouseEvent")
        .map((call) => (call as unknown[])[1]),
    ).toEqual([
      expect.objectContaining({ type: "mouseMoved" }),
      expect.objectContaining({ type: "mousePressed", button: "left", clickCount: 1 }),
      expect.objectContaining({ type: "mouseReleased", button: "left", clickCount: 1 }),
      expect.objectContaining({ type: "mousePressed", button: "left", clickCount: 2 }),
      expect.objectContaining({ type: "mouseReleased", button: "left", clickCount: 2 }),
    ]);

    const hover = mediaFrame();
    await perform(hover.page, "hover");
    expect(hover.send).toHaveBeenLastCalledWith("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "none",
      x: 20,
      y: 30,
    });
  });

  it("rejects other methods and controls without a box", async () => {
    const { page, send } = mediaFrame();
    await expect(perform(page, "fill", ["x"])).rejects.toThrow(
      "Method fill is not supported on a native media control",
    );
    expect(send).not.toHaveBeenCalled();

    send.mockResolvedValue({});
    await expect(perform(page, "click")).rejects.toThrow(
      "Native media control is not visible (no box model)",
    );
    expect(send).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", expect.anything());
  });
});
