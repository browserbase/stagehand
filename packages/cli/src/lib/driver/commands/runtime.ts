import { promises as fs } from "node:fs";

import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

const CURSOR_OVERLAY_SCRIPT = `(() => {
  const cursorId = "__browse_cursor_overlay__";
  const ensureCursor = () => {
    const existing = document.getElementById(cursorId);
    if (existing instanceof HTMLDivElement) return existing;

    const root = document.documentElement || document.body;
    if (!root) return null;

    const cursor = document.createElement("div");
    cursor.id = cursorId;
    cursor.setAttribute("aria-hidden", "true");
    Object.assign(cursor.style, {
      contain: "layout style paint",
      height: "24px",
      left: "0px",
      mixBlendMode: "normal",
      pointerEvents: "none",
      position: "fixed",
      top: "0px",
      userSelect: "none",
      width: "16px",
      willChange: "left,top",
      zIndex: "2147483647",
    });
    cursor.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><path d="M1 0 L1 22 L6 14 L15 14 Z" fill="black" stroke="white" stroke-width="0.7"/></svg>';
    root.appendChild(cursor);
    return cursor;
  };

  ensureCursor();
  if (!globalThis.__browseCursorOverlayListenerInstalled__) {
    document.addEventListener(
      "mousemove",
      (event) => {
        const cursor = ensureCursor();
        if (!cursor) return;
        cursor.style.left = Math.max(0, event.clientX) + "px";
        cursor.style.top = Math.max(0, event.clientY) + "px";
      },
      { capture: true },
    );
    globalThis.__browseCursorOverlayListenerInstalled__ = true;
  }
})()`;

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
      ...(options.animations === undefined
        ? {}
        : { animations: options.animations }),
      ...(options.caret === undefined ? {} : { caret: options.caret }),
      ...(options.clip === undefined ? {} : { clip: options.clip }),
      ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
      ...(options.quality === undefined ? {} : { quality: options.quality }),
      timeout: 10_000,
      ...(options.type === undefined ? {} : { type: options.type }),
    });
    if (options.path) {
      await fs.writeFile(options.path, buffer);
      return { saved: options.path };
    }
    return { base64: Buffer.from(buffer).toString("base64") };
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
    await page.evaluate(CURSOR_OVERLAY_SCRIPT);
    return { enabled: true };
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
