import { z } from "zod";

import { updateCursorOverlayPosition } from "../cursor-overlay.js";
import type { DriverPage, DriverSessionManager } from "../session-manager.js";
import type { DriverCommandHandlers } from "./types.js";

const ButtonSchema = z.enum(["left", "right", "middle"]).optional();

export const mouseHandlers: DriverCommandHandlers = {
  async "mouse.click"(manager, params) {
    const { button, clickCount, x, y } = z
      .object({
        button: ButtonSchema,
        clickCount: z.number().int().positive().optional(),
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.click(x, y, {
      ...(button === undefined ? {} : { button }),
      ...(clickCount === undefined ? {} : { clickCount }),
    });
    return { clicked: true };
  },

  async "mouse.hover"(manager, params) {
    const { x, y } = z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.hover(x, y);
    return { hovered: true };
  },

  async "mouse.scroll"(manager, params) {
    const { deltaX, deltaY, x, y } = z
      .object({
        deltaX: z.number(),
        deltaY: z.number(),
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.scroll(x, y, deltaX, deltaY);
    return { scrolled: true };
  },

  async "mouse.drag"(manager, params) {
    const { button, delay, fromX, fromY, steps, toX, toY } = z
      .object({
        button: ButtonSchema,
        delay: z.number().int().nonnegative().optional(),
        fromX: z.number(),
        fromY: z.number(),
        steps: z.number().int().positive().optional(),
        toX: z.number(),
        toY: z.number(),
      })
      .parse(params);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, fromX, fromY);
    await page.dragAndDrop(fromX, fromY, toX, toY, {
      ...(button === undefined ? {} : { button }),
      ...(delay === undefined ? {} : { delay }),
      ...(steps === undefined ? {} : { steps }),
    });
    await positionCursorOverlay(manager, page, toX, toY);
    return { dragged: true };
  },
};

async function positionCursorOverlay(
  manager: DriverSessionManager,
  page: DriverPage,
  x: number,
  y: number,
): Promise<void> {
  if (!manager.isCursorOverlayEnabled(page)) return;
  await page.evaluate(updateCursorOverlayPosition, { x, y });
}
