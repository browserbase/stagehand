import type { Protocol } from "devtools-protocol";
import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { StagehandLogger } from "../logger.js";
import { Page } from "../understudy/page.js";
import { Keyboard } from "../understudy/keyboard.js";
import { Progress } from "../understudy/progress.js";

function setup() {
  const events: Protocol.Input.DispatchKeyEventRequest[] = [];
  const send = vi.fn(async (method: string, event: object = {}) => {
    if (method === "Input.dispatchKeyEvent")
      events.push(event as Protocol.Input.DispatchKeyEventRequest);
    return {};
  });
  const session = { id: "main", send, on: vi.fn(), off: vi.fn(), close: vi.fn() } as CDPSessionLike;
  return { keyboard: new Keyboard(session), session, send, events };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("page keyboard state", () => {
  it("keeps page methods on the same keyboard", async () => {
    const { session, events } = setup();
    const page = new Page(
      {} as CdpConnection,
      session,
      "target",
      "frame",
      new StagehandLogger({ tracer: trace.getTracer("test") }, () => {}),
    );
    await page.keyDown("Shift");
    await page.keyPress("a");
    await page.keyUp("Shift");
    expect(events).toMatchObject([
      { type: "rawKeyDown", key: "Shift", modifiers: 8 },
      { type: "keyDown", key: "A", code: "KeyA", text: "A", modifiers: 8 },
      { type: "keyUp", key: "A", modifiers: 8 },
      { type: "keyUp", key: "Shift", modifiers: 0 },
    ]);
  });

  it("shares held modifiers with page and frame mouse input", async () => {
    const { session, send } = setup();
    const page = new Page(
      {} as CdpConnection,
      session,
      "target",
      "frame",
      new StagehandLogger({ tracer: trace.getTracer("test") }, () => {}),
    );
    vi.spyOn(page, "updateCursor").mockResolvedValue(undefined);
    await page.keyDown("Shift");
    expect(page.mainFrameWrapper.inputModifiers()).toBe(8);
    await page.click(10, 20);
    await page.keyUp("Shift");
    expect(page.mainFrameWrapper.inputModifiers()).toBe(0);
    await page.click(10, 20);
    expect(
      send.mock.calls
        .filter(([method]) => method === "Input.dispatchMouseEvent")
        .map(([, event]) => event),
    ).toMatchObject([
      { type: "mouseMoved", modifiers: 8 },
      { type: "mousePressed", modifiers: 8 },
      { type: "mouseReleased", modifiers: 8 },
      { type: "mouseMoved", modifiers: 0 },
      { type: "mousePressed", modifiers: 0 },
      { type: "mouseReleased", modifiers: 0 },
    ]);
  });

  it("preserves caller-held keys through a chord and tracks physical repeats", async () => {
    const { keyboard, events } = setup();
    await keyboard.down("shift");
    await keyboard.press("Shift+b");
    await keyboard.down("a");
    await keyboard.down("A");
    await keyboard.up("a");
    await keyboard.up("SHIFT");
    expect(
      events.map(({ type, key, modifiers, autoRepeat }) => ({ type, key, modifiers, autoRepeat })),
    ).toEqual([
      { type: "rawKeyDown", key: "Shift", modifiers: 8, autoRepeat: false },
      { type: "keyDown", key: "B", modifiers: 8, autoRepeat: false },
      { type: "keyUp", key: "B", modifiers: 8, autoRepeat: undefined },
      { type: "keyDown", key: "A", modifiers: 8, autoRepeat: false },
      { type: "keyDown", key: "A", modifiers: 8, autoRepeat: true },
      { type: "keyUp", key: "A", modifiers: 8, autoRepeat: undefined },
      { type: "keyUp", key: "Shift", modifiers: 0, autoRepeat: undefined },
    ]);
  });

  it.each([
    [".", "Period", 190],
    ["(", "Digit9", 57],
    ["+", "Equal", 187],
    ["é", undefined, undefined],
  ])("uses safe key identity for %s", async (key, code, vk) => {
    const { keyboard, events } = setup();
    await keyboard.press(String(key));
    expect(events[0]).toMatchObject({ type: "keyDown", key, text: key });
    expect(events[0].code).toBe(code);
    expect(events[0].windowsVirtualKeyCode).toBe(vk);
  });

  it("suppresses text under Control, Alt, and Meta and releases modifiers in event order", async () => {
    const { keyboard, events } = setup();
    await keyboard.down("Ctrl");
    await keyboard.down("Alt");
    await keyboard.down("Meta");
    await keyboard.press("A");
    await keyboard.up("Control");
    await keyboard.up("Alt");
    await keyboard.up("Meta");
    expect(events[3]).toMatchObject({ type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 7 });
    expect(events[3].text).toBeUndefined();
    expect(events.slice(-3).map(({ modifiers }) => modifiers)).toEqual([5, 4, 0]);
  });

  it.each(["MacIntel", "Linux x86_64"])("normalizes platform shortcuts on %s", async (platform) => {
    vi.stubGlobal("navigator", { platform });
    const { keyboard, events } = setup();
    await keyboard.press("Cmd+A");
    await keyboard.press("ControlOrMeta+A");
    const mac = platform === "MacIntel";
    for (const offset of [0, 4]) {
      expect(events[offset]).toMatchObject({
        key: mac ? "Meta" : "Control",
        modifiers: mac ? 4 : 2,
      });
      expect(events[offset + 1]).toMatchObject({ key: "a", code: "KeyA" });
      expect(events[offset + 1].commands).toEqual(mac ? ["selectAll"] : undefined);
    }
  });

  it.each(["constructor", "__proto__", "toString"])(
    "does not interpret inherited property %s as a key definition",
    async (key) => {
      const { keyboard, events } = setup();
      await keyboard.press(key);
      expect(events[0]).toMatchObject({ key, modifiers: 0 });
      expect(events[0].windowsVirtualKeyCode).toBeUndefined();
    },
  );

  it("does not commit failed dispatches and serializes concurrent commands", async () => {
    const { keyboard, send, events } = setup();
    send.mockRejectedValueOnce(new Error("rejected"));
    await expect(keyboard.down("Shift")).rejects.toThrow("rejected");
    await Promise.all([keyboard.down("Control"), keyboard.down("a"), keyboard.up("Control")]);
    expect(events.map(({ modifiers }) => modifiers)).toEqual([2, 2, 0]);
    send.mockRejectedValueOnce(new Error("rejected"));
    await keyboard.down("Shift").catch(() => {});
    await keyboard.down("Shift");
    send.mockRejectedValueOnce(new Error("rejected"));
    await expect(keyboard.up("Shift")).rejects.toThrow("rejected");
    await keyboard.press("b");
    expect(events.at(-2)).toMatchObject({ key: "B", modifiers: 8 });
  });

  it("cleans a failed chord without releasing an existing modifier", async () => {
    const { keyboard, send, events } = setup();
    await keyboard.down("Shift");
    send.mockRejectedValueOnce(new Error("rejected"));
    await expect(keyboard.press("Control+a")).rejects.toThrow("rejected");
    await keyboard.press("b");
    expect(events.filter(({ type, key }) => type === "keyUp" && key === "Shift")).toEqual([]);
    expect(events.at(-2)).toMatchObject({ key: "B", modifiers: 8 });
  });

  it("cleans up late keydown responses before the next queued operation", async () => {
    vi.useFakeTimers();
    const { keyboard, send, events } = setup();
    send.mockImplementationOnce(async (_method, event = {}) => {
      events.push(event as Protocol.Input.DispatchKeyEventRequest);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {};
    });
    const progress = new Progress("press", 20);
    const rejected = expect(keyboard.press("Control+a", undefined, progress)).rejects.toThrow(
      "timed out",
    );
    const next = keyboard.press("b");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await next;
    expect(events.map(({ type, key, modifiers }) => ({ type, key, modifiers }))).toEqual([
      { type: "rawKeyDown", key: "Control", modifiers: 2 },
      { type: "keyUp", key: "Control", modifiers: 0 },
      { type: "keyDown", key: "b", modifiers: 0 },
      { type: "keyUp", key: "b", modifiers: 0 },
    ]);
    progress.dispose();
  });

  it.each(["before", "during"])(
    "releases each key once when expiry occurs %s release",
    async (phase) => {
      vi.useFakeTimers();
      const { keyboard, send, events } = setup();
      send.mockImplementation(async (_method, event = {}) => {
        const keyEvent = event as Protocol.Input.DispatchKeyEventRequest;
        events.push(keyEvent);
        if (phase === "during" && keyEvent.type === "keyUp" && keyEvent.key === "a") {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {};
      });
      const progress = new Progress("press", 20);
      const result = keyboard.press("Control+A", { delay: phase === "before" ? 50 : 0 }, progress);
      const rejected = expect(result).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(events.map(({ type, key }) => ({ type, key }))).toEqual([
        { type: "rawKeyDown", key: "Control" },
        { type: "rawKeyDown", key: "a" },
        { type: "keyUp", key: "a" },
        { type: "keyUp", key: "Control" },
      ]);
      progress.dispose();
    },
  );

  it("retries a rejected chord release before continuing", async () => {
    const { keyboard, send, events } = setup();
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("release failed"));
    await expect(keyboard.press("Shift")).rejects.toThrow("release failed");
    await keyboard.press("a");
    expect(events.at(-2)).toMatchObject({ key: "a", modifiers: 0 });
  });
});
