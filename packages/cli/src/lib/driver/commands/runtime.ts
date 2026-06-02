import { promises as fs } from "node:fs";

import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

export const runtimeHandlers: DriverCommandHandlers = {
  async screenshot(manager, params) {
    const options = z
      .object({
        animations: z.enum(["allow", "disabled"]).optional(),
        caret: z.enum(["hide", "initial"]).optional(),
        clip: z
          .object({
            height: z.number().positive(),
            width: z.number().positive(),
            x: z.number(),
            y: z.number(),
          })
          .optional(),
        fullPage: z.boolean().optional(),
        path: z.string().optional(),
        quality: z.number().int().min(0).max(100).optional(),
        type: z.enum(["jpeg", "png"]).optional(),
      })
      .parse(params);
    const page = await manager.activePage();
    const buffer = await page.screenshot({
      animations: options.animations,
      caret: options.caret,
      clip: options.clip,
      fullPage: options.fullPage,
      quality: options.quality,
      timeout: 10_000,
      type: options.type,
    });
    if (options.path) {
      await fs.writeFile(options.path, buffer);
      return { saved: options.path };
    }
    return { base64: buffer.toString("base64") };
  },

  async viewport(manager, params) {
    const { height, scale, width } = z
      .object({
        height: z.number().int().positive(),
        scale: z.number().positive().optional(),
        width: z.number().int().positive(),
      })
      .parse(params);
    const page = await manager.activePage();
    await page.setViewportSize(width, height, {
      deviceScaleFactor: scale ?? 1,
    });
    return { viewport: { height, width } };
  },

  async wait(manager, params) {
    const { arg, state, timeoutMs, type } = z
      .object({
        arg: z.string().optional(),
        state: z.enum(["attached", "detached", "hidden", "visible"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        type: z.enum(["load", "selector", "timeout"]),
      })
      .parse(params);
    const page = await manager.activePage();

    if (type === "load") {
      await page.waitForLoadState(
        (arg as "domcontentloaded" | "load" | "networkidle" | undefined) ??
          "load",
        timeoutMs,
      );
    } else if (type === "selector") {
      if (!arg) throw new Error("wait selector requires a selector argument.");
      await page.waitForSelector(manager.resolveSelector(arg), {
        state: state ?? "visible",
        timeout: timeoutMs ?? 30_000,
      });
    } else {
      await page.waitForTimeout(parseTimeoutMs(arg));
    }

    return { waited: true };
  },

  async cursor(manager) {
    const page = await manager.activePage();
    await page.enableCursorOverlay();
    return { cursor: "enabled" };
  },
};

function parseTimeoutMs(value: string | undefined): number {
  if (value === undefined) return 0;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error(
      "wait timeout requires a non-negative integer number of milliseconds.",
    );
  }

  return timeoutMs;
}
