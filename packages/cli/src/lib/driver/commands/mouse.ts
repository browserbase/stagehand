import { z } from "zod";

import { updateCursorOverlayPosition } from "../cursor-overlay.js";
import type { DriverPage, DriverSessionManager } from "../session-manager.js";
import type { DriverCommandHandlers } from "./types.js";

const ButtonSchema = z.enum(["left", "right", "middle"]).optional();

export const mouseHandlers: DriverCommandHandlers = {
  async "mouse.click"(manager, params) {
    const { button, clickCount, returnXPath, x, y } = z
      .object({
        button: ButtonSchema,
        clickCount: z.number().int().positive().optional(),
        returnXPath: z.boolean().optional(),
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    assertXPathUnavailable(returnXPath);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.click(x, y, {
      ...(button === undefined ? {} : { button }),
      ...(clickCount === undefined ? {} : { clickCount }),
    });
    return { clicked: true };
  },

  async "mouse.hover"(manager, params) {
    const { returnXPath, x, y } = z
      .object({
        returnXPath: z.boolean().optional(),
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    assertXPathUnavailable(returnXPath);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.hover(x, y);
    return { hovered: true };
  },

  async "mouse.scroll"(manager, params) {
    const { deltaX, deltaY, returnXPath, x, y } = z
      .object({
        deltaX: z.number(),
        deltaY: z.number(),
        returnXPath: z.boolean().optional(),
        x: z.number(),
        y: z.number(),
      })
      .parse(params);
    assertXPathUnavailable(returnXPath);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, x, y);
    await page.scroll(x, y, deltaX, deltaY);
    return { scrolled: true };
  },

  async "mouse.drag"(manager, params) {
    const { button, delay, fromX, fromY, returnXPath, steps, toX, toY } = z
      .object({
        button: ButtonSchema,
        delay: z.number().int().nonnegative().optional(),
        fromX: z.number(),
        fromY: z.number(),
        returnXPath: z.boolean().optional(),
        steps: z.number().int().positive().optional(),
        toX: z.number(),
        toY: z.number(),
      })
      .parse(params);
    assertXPathUnavailable(returnXPath);
    const page = await manager.activePage();
    await positionCursorOverlay(manager, page, fromX, fromY);
    await page.dragAndDrop(fromX, fromY, toX, toY, {
      ...(button === undefined ? {} : { button }),
      ...(delay === undefined ? {} : { delay }),
      ...(steps === undefined ? {} : { steps }),
    });
    // A successful drag may navigate and destroy the old execution context.
    // The final marker position is visual-only, so do not turn that race into a
    // reported drag failure.
    await positionCursorOverlay(manager, page, toX, toY).catch(() => undefined);
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

function assertXPathUnavailable(returnXPath: boolean | undefined): void {
  if (returnXPath) {
    throw new Error("Coordinate XPath lookup is not exposed by Stagehand V4");
  }
}
