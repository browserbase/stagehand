import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSelectorWait } from "../dom/locatorScripts/waitForSelector.js";

describe("injected waitForSelector", () => {
  const querySelector = vi.fn();
  const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  let dom: {
    body: object | null;
    documentElement: object | null;
    querySelector: typeof querySelector;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  let ready: () => void;
  const element = () => ({
    children: [],
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    querySelector.mockReset().mockReturnValue(null);
    observers.length = 0;
    dom = {
      body: element(),
      documentElement: null,
      querySelector,
      addEventListener: vi.fn((_event, listener) => {
        ready = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", dom);
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        disconnect = vi.fn();
        constructor(callback: () => void) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([undefined, 75])("expires with timeout %s", async (timeout) => {
    const duration = timeout ?? 30_000;
    const settled = vi.fn();
    const pending = createSelectorWait("button", "attached", timeout, false).promise;
    void pending.then(settled, settled);
    const rejected = expect(pending).rejects.toThrow(`Timeout ${duration}ms exceeded`);
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("keeps zero unlimited and can still settle on a later mutation", async () => {
    const settled = vi.fn();
    const pending = createSelectorWait("button", "attached", 0, false).promise;
    void pending.then(settled, settled);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();
    querySelector.mockReturnValue(element());
    observers[0].callback();
    await expect(pending).resolves.toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it.each(["attached", "detached", "visible", "hidden"])(
    "cleans up once when %s is reached",
    async (state) => {
      const node = element();
      querySelector.mockReturnValue(state === "detached" || state === "hidden" ? node : null);
      const wait = createSelectorWait("button", state, 100, true);
      querySelector.mockReturnValue(state === "detached" ? null : node);
      if (state === "hidden")
        vi.spyOn(window, "getComputedStyle").mockReturnValue({
          display: "none",
        } as CSSStyleDeclaration);
      observers[0].callback();
      await expect(wait.promise).resolves.toBe(true);
      wait.dispose();
      observers[0].callback();
      expect(observers[0].disconnect).toHaveBeenCalledOnce();
      expect(observers).toHaveLength(1);
    },
  );

  it.each([false, true])("handles DOM readiness with already matched=%s", async (matched) => {
    dom.body = null;
    const wait = createSelectorWait("button", "attached", 100, false);
    expect(observers).toHaveLength(0);
    dom.body = element();
    if (matched) querySelector.mockReturnValue(element());
    ready();
    expect(observers).toHaveLength(matched ? 0 : 1);
    if (!matched) {
      querySelector.mockReturnValue(element());
      observers[0].callback();
    }
    await expect(wait.promise).resolves.toBe(true);
    wait.dispose();
    expect(dom.removeEventListener).toHaveBeenCalledExactlyOnceWith("DOMContentLoaded", ready);
  });

  it.each(["timeout", "dispose"])("removes the DOM-ready listener on %s", async (ending) => {
    dom.body = null;
    const wait = createSelectorWait("button", "attached", ending === "timeout" ? 50 : 0, false);
    const rejected = expect(wait.promise).rejects.toThrow();
    if (ending === "timeout") await vi.advanceTimersByTimeAsync(50);
    else wait.dispose();
    await rejected;
    wait.dispose();
    expect(dom.removeEventListener).toHaveBeenCalledExactlyOnceWith("DOMContentLoaded", ready);
    dom.body = element();
    // A queued listener must not install observers after settlement.
    ready();
    expect(observers).toHaveLength(0);
  });

  it("does not rescan shadow roots after a shadow mutation settles the wait", async () => {
    const shadow = { children: [] };
    dom.body = { children: [], shadowRoot: shadow };
    const wait = createSelectorWait("button", "attached", 100, true);
    expect(observers).toHaveLength(2);
    (shadow.children as object[]).push({ children: [], shadowRoot: { children: [] } });
    querySelector.mockReturnValue(element());
    observers[1].callback();
    await expect(wait.promise).resolves.toBe(true);
    wait.dispose();
    expect(observers).toHaveLength(2);
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("disposes one unlimited wait without cancelling another", async () => {
    const first = createSelectorWait("button", "attached", 0, true);
    const second = createSelectorWait("button", "attached", 0, true);
    first.dispose();
    await expect(first.promise).rejects.toThrow("disposed");
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(observers[1].disconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    querySelector.mockReturnValue(element());
    await vi.advanceTimersByTimeAsync(100);
    await expect(second.promise).resolves.toBe(true);
    second.dispose();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  });

  it("cleans up partial installation when observation fails", async () => {
    vi.stubGlobal(
      "MutationObserver",
      class {
        disconnect = vi.fn();
        constructor(callback: () => void) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe() {
          throw new Error("observation failed");
        }
      },
    );
    const wait = createSelectorWait("button", "attached", 100, true);
    await expect(wait.promise).rejects.toThrow("observation failed");
    wait.dispose();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });
});
