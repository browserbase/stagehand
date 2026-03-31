import { anthropic } from "@ai-sdk/anthropic";
import type { ToolSet } from "ai";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./cuaUtils.js";
import {
  getConfiguredViewport,
  createCuaResult,
  cuaToModelOutput,
} from "./cuaUtils.js";

interface AnthropicComputerInput {
  action:
    | "key"
    | "hold_key"
    | "type"
    | "cursor_position"
    | "mouse_move"
    | "left_mouse_down"
    | "left_mouse_up"
    | "left_click"
    | "left_click_drag"
    | "right_click"
    | "middle_click"
    | "double_click"
    | "triple_click"
    | "scroll"
    | "wait"
    | "screenshot";
  coordinate?: [number, number];
  duration?: number;
  scroll_amount?: number;
  scroll_direction?: "up" | "down" | "left" | "right";
  start_coordinate?: [number, number];
  text?: string;
}

async function executeComputerAction(
  v3: V3,
  input: AnthropicComputerInput,
): Promise<CuaToolResult> {
  try {
    const page = await v3.context.awaitActivePage();
    const { action } = input;

    v3.logger({
      category: "agent",
      message: `Anthropic CUA: ${action}${input.coordinate ? ` at (${input.coordinate[0]}, ${input.coordinate[1]})` : ""}`,
      level: 1,
    });

    switch (action) {
      case "screenshot":
        return createCuaResult(v3, true);

      case "left_click": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.click(x, y, { button: "left" });
        return createCuaResult(v3, true);
      }

      case "right_click": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.click(x, y, { button: "right" });
        return createCuaResult(v3, true);
      }

      case "middle_click": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.click(x, y, { button: "middle" });
        return createCuaResult(v3, true);
      }

      case "double_click": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.click(x, y, { button: "left", clickCount: 2 });
        return createCuaResult(v3, true);
      }

      case "triple_click": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.click(x, y, { button: "left", clickCount: 3 });
        return createCuaResult(v3, true);
      }

      case "type": {
        if (input.text) {
          await page.type(input.text);
        }
        return createCuaResult(v3, true);
      }

      case "key": {
        if (input.text) {
          await page.keyPress(input.text);
        }
        return createCuaResult(v3, true);
      }

      case "hold_key": {
        if (input.text) {
          const durationMs = (input.duration ?? 1) * 1000;
          await page.keyPress(input.text, { delay: durationMs });
        }
        return createCuaResult(v3, true);
      }

      case "scroll": {
        const [x, y] = input.coordinate ?? [0, 0];
        const scrollAmount = (input.scroll_amount ?? 3) * 100;
        let scrollX = 0;
        let scrollY = 0;

        switch (input.scroll_direction) {
          case "up":
            scrollY = -scrollAmount;
            break;
          case "down":
            scrollY = scrollAmount;
            break;
          case "left":
            scrollX = -scrollAmount;
            break;
          case "right":
            scrollX = scrollAmount;
            break;
        }

        await page.scroll(x, y, scrollX, scrollY);
        return createCuaResult(v3, true);
      }

      case "mouse_move": {
        const [x, y] = input.coordinate ?? [0, 0];
        await page.hover(x, y);
        return createCuaResult(v3, true);
      }

      case "left_click_drag": {
        const [startX, startY] = input.start_coordinate ?? [0, 0];
        const [endX, endY] = input.coordinate ?? [0, 0];
        await page.dragAndDrop(startX, startY, endX, endY, {
          steps: 10,
          delay: 10,
        });
        return createCuaResult(v3, true);
      }

      case "left_mouse_down": {
        const [x, y] = input.coordinate ?? [0, 0];
        const sessionDown = page.getSessionForFrame(page.mainFrameId());
        await sessionDown.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "none",
        });
        await sessionDown.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        return createCuaResult(v3, true);
      }

      case "left_mouse_up": {
        const sessionUp = page.getSessionForFrame(page.mainFrameId());
        await sessionUp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: 0,
          y: 0,
          button: "left",
          clickCount: 1,
        });
        return createCuaResult(v3, true);
      }

      case "cursor_position": {
        return createCuaResult(v3, true);
      }

      case "wait": {
        const durationMs = (input.duration ?? 3) * 1000;
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        return createCuaResult(v3, true);
      }

      default: {
        v3.logger({
          category: "agent",
          message: `Anthropic CUA: unknown action "${action}", taking screenshot`,
          level: 0,
        });
        return createCuaResult(v3, true);
      }
    }
  } catch (error) {
    return createCuaResult(v3, false, (error as Error).message);
  }
}

export function createAnthropicCuaTool(v3: V3): ToolSet[string] {
  const viewport = getConfiguredViewport(v3);

  return anthropic.tools.computer_20250124({
    displayWidthPx: viewport.width,
    displayHeightPx: viewport.height,
    execute: async (input) => executeComputerAction(v3, input),
    toModelOutput: cuaToModelOutput,
  }) as ToolSet[string];
}
