import { describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import { Locator } from "./locator.js";

type SelectionState = {
  panelOpen: boolean;
  step: number;
  rowClass: string;
  ariaPressed: string;
};

function snapshot(state: SelectionState): SelectionState {
  return { ...state };
}

describe("Locator.click", () => {
  it("commits a reactive selection after each mouse event settles", async () => {
    const state: SelectionState = {
      panelOpen: true,
      step: 25,
      rowClass: "option",
      ariaPressed: "false",
    };
    const dispatchTrace: string[] = [];
    let inputInFlight = false;

    const send = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "DOM.getBoxModel") {
        return { model: { content: [0, 0, 20, 0, 20, 10, 0, 10] } };
      }
      if (method !== "Input.dispatchMouseEvent") return {};

      const type = String(params.type);
      if (inputInFlight) {
        dispatchTrace.push(`overlap:${type}`);
        return {};
      }

      inputInFlight = true;
      dispatchTrace.push(type);
      try {
        if (type === "mouseMoved") {
          state.rowClass = "option option--hovered";
        } else if (type === "mousePressed" && state.rowClass.includes("option--hovered")) {
          state.ariaPressed = "true";
        } else if (type === "mouseReleased" && state.ariaPressed === "true") {
          state.panelOpen = false;
          state.step += 1;
        }

        await Promise.resolve();
      } finally {
        inputInFlight = false;
      }
      return {};
    });

    const frame = { session: { send } } as unknown as Frame;
    const locator = new Locator(frame, "xpath=//*[@role='button']");
    vi.spyOn(locator, "resolveNode").mockResolvedValue({
      nodeId: null,
      objectId: "target-object",
    });

    expect(snapshot(state)).toEqual({
      panelOpen: true,
      step: 25,
      rowClass: "option",
      ariaPressed: "false",
    });

    await locator.click();

    expect(snapshot(state)).toEqual({
      panelOpen: false,
      step: 26,
      rowClass: "option option--hovered",
      ariaPressed: "true",
    });
    expect(dispatchTrace).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
  });
});
