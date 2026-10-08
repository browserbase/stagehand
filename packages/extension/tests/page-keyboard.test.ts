import { describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";

function setup() {
  const send = vi.fn(async (_method: string, _params?: unknown) => ({}));
  const session = {
    id: "main",
    send,
    on: vi.fn(),
    close: vi.fn(async () => {}),
    off: vi.fn(),
  } as CDPSessionLike;
  const page = new Page({} as CdpConnection, session, "target", "frame", {} as StagehandLogger);
  return {
    page,
    keyEvents: () =>
      send.mock.calls
        .filter(([method]) => method === "Input.dispatchKeyEvent")
        .map(([, params]) => params),
  };
}

describe("printable key identity", () => {
  it.each([
    ["w", "KeyW", 87],
    ["W", "KeyW", 87],
    ["1", "Digit1", 49],
    [" ", "Space", 32],
    [".", "Period", 190],
    ["(", "Digit9", 57],
    ["%", "Digit5", 53],
    ["'", "Quote", 222],
    ["$", "Digit4", 52],
    ["-", "Minus", 189],
    ["+", "Equal", 187],
  ])(
    "preserves the key, code, and US-layout VK for %j on both down and up",
    async (key, code, vk) => {
      const { page, keyEvents } = setup();
      await page.keyPress(key);
      expect(keyEvents()).toEqual([
        {
          type: "keyDown",
          key,
          code,
          windowsVirtualKeyCode: vk,
          text: key,
          unmodifiedText: key,
          modifiers: 0,
        },
        { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: 0 },
      ]);
    },
  );

  it("omits code and VK for characters outside the US layout", async () => {
    const { page, keyEvents } = setup();
    await page.keyPress("é");
    expect(keyEvents()).toEqual([
      { type: "keyDown", key: "é", text: "é", unmodifiedText: "é", modifiers: 0 },
      { type: "keyUp", key: "é", code: undefined, windowsVirtualKeyCode: undefined, modifiers: 0 },
    ]);
  });

  it("reports the unshifted letter for shortcuts", async () => {
    const { page, keyEvents } = setup();
    await page.keyPress("Control+A");
    expect(keyEvents()).toEqual([
      expect.objectContaining({ type: "rawKeyDown", key: "Control", modifiers: 2 }),
      { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 },
      expect.objectContaining({ type: "keyUp", key: "a", code: "KeyA", modifiers: 2 }),
      expect.objectContaining({ type: "keyUp", key: "Control" }),
    ]);
  });
});
