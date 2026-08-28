import { z } from "zod";

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
    await page.dragAndDrop(fromX, fromY, toX, toY, {
      ...(button === undefined ? {} : { button }),
      ...(delay === undefined ? {} : { delay }),
      ...(steps === undefined ? {} : { steps }),
    });
    return { dragged: true };
  },
};

function assertXPathUnavailable(returnXPath: boolean | undefined): void {
  if (returnXPath) {
    throw new Error("Coordinate XPath lookup is not exposed by Stagehand V4");
  }
}
