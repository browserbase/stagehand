import { describe, expect, it, vi } from "vitest";

import { clipboardHandlers } from "../src/lib/driver/commands/clipboard.js";
import type { DriverSessionManager } from "../src/lib/driver/session-manager.js";

function makeManager(clipboard: Record<string, ReturnType<typeof vi.fn>>) {
  return {
    browserContext: vi.fn().mockResolvedValue({ clipboard }),
  } as unknown as DriverSessionManager;
}

describe("clipboard driver handlers", () => {
  it("reads clipboard text", async () => {
    const readText = vi.fn().mockResolvedValue("copied value");
    const manager = makeManager({ readText });

    await expect(
      clipboardHandlers["clipboard.read"]!(manager, {}),
    ).resolves.toEqual({ text: "copied value" });
    expect(readText).toHaveBeenCalledOnce();
  });

  it("writes clipboard text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const manager = makeManager({ writeText });

    await expect(
      clipboardHandlers["clipboard.write"]!(manager, { text: "hello" }),
    ).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("pastes with an optional shortcut", async () => {
    const paste = vi.fn().mockResolvedValue(undefined);
    const manager = makeManager({ paste });

    await expect(
      clipboardHandlers["clipboard.paste"]!(manager, {
        shortcut: "Control+V",
      }),
    ).resolves.toEqual({ ok: true });
    expect(paste).toHaveBeenCalledWith({ shortcut: "Control+V" });
  });

  it("clears, copies, and cuts via clipboard helpers", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);
    const cut = vi.fn().mockResolvedValue(undefined);
    const manager = makeManager({ clear, copy, cut });

    await expect(
      clipboardHandlers["clipboard.clear"]!(manager, {}),
    ).resolves.toEqual({ ok: true });
    await expect(
      clipboardHandlers["clipboard.copy"]!(manager, {}),
    ).resolves.toEqual({ ok: true });
    await expect(
      clipboardHandlers["clipboard.cut"]!(manager, {}),
    ).resolves.toEqual({
      ok: true,
    });
    expect(clear).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(cut).toHaveBeenCalledOnce();
  });
});
