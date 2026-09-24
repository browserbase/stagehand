import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

const writeParamsSchema = z.object({
  text: z.string(),
});

const pasteParamsSchema = z.object({
  shortcut: z.enum(["ControlOrMeta+V", "Meta+V", "Control+V"]).optional(),
});

export const clipboardHandlers: DriverCommandHandlers = {
  async "clipboard.read"(manager) {
    const context = await manager.browserContext();
    const text = await context.clipboard.readText();
    return { text };
  },

  async "clipboard.write"(manager, params) {
    const { text } = writeParamsSchema.parse(params);
    const context = await manager.browserContext();
    await context.clipboard.writeText(text);
    return { ok: true };
  },

  async "clipboard.clear"(manager) {
    const context = await manager.browserContext();
    await context.clipboard.clear();
    return { ok: true };
  },

  async "clipboard.paste"(manager, params) {
    const { shortcut } = pasteParamsSchema.parse(params ?? {});
    const context = await manager.browserContext();
    await context.clipboard.paste(shortcut ? { shortcut } : undefined);
    return { ok: true };
  },

  async "clipboard.copy"(manager) {
    const context = await manager.browserContext();
    await context.clipboard.copy();
    return { ok: true };
  },

  async "clipboard.cut"(manager) {
    const context = await manager.browserContext();
    await context.clipboard.cut();
    return { ok: true };
  },
};
