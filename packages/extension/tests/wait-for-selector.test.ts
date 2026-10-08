import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForSelector } from "../dom/locatorScripts/waitForSelector.js";

describe("injected waitForSelector timeouts", () => {
  let mutation: () => void;
  const querySelector = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    querySelector.mockReset().mockReturnValue(null);
    disconnect.mockReset();
    vi.stubGlobal("document", { body: {}, querySelector });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          mutation = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([undefined, 75])("expires with timeout %s", async (timeout) => {
    const duration = timeout ?? 30_000;
    const settled = vi.fn();
    const pending = waitForSelector("button", "attached", timeout, false);
    void pending.then(settled, settled);
    const rejected = expect(pending).rejects.toThrow(`Timeout ${duration}ms exceeded`);
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps zero unlimited and can still settle on a later mutation", async () => {
    const settled = vi.fn();
    const pending = waitForSelector("button", "attached", 0, false);
    void pending.then(settled, settled);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();
    querySelector.mockReturnValue({});
    mutation();
    await expect(pending).resolves.toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
