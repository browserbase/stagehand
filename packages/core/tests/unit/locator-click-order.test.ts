import { describe, expect, it, vi } from "vitest";
import { Frame } from "../../lib/v3/understudy/frame.js";
import { Locator } from "../../lib/v3/understudy/locator.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";

describe("Locator.click", () => {
  it("waits for each mouse event before dispatching the next one", async () => {
    const inputTypes: string[] = [];
    let inputInFlight = false;
    const session = new MockCDPSession({
      "DOM.getBoxModel": () => ({
        model: {
          content: [0, 0, 20, 0, 20, 10, 0, 10],
        },
      }),
      "Input.dispatchMouseEvent": async (params) => {
        if (inputInFlight) {
          throw new Error("mouse events overlapped");
        }
        inputInFlight = true;
        inputTypes.push(String(params?.type));
        await Promise.resolve();
        inputInFlight = false;
      },
    });
    const frame = new Frame(session, "frame-1", "page-1", false);
    const locator = new Locator(frame, "#target");
    vi.spyOn(locator, "resolveNode").mockResolvedValue({
      nodeId: null,
      objectId: "target-object",
    });

    await expect(locator.click({ clickCount: 2 })).resolves.toBeUndefined();
    expect(inputTypes).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
      "mousePressed",
      "mouseReleased",
    ]);
  });
});
