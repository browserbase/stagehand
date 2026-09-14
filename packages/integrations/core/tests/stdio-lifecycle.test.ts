import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCodeModeStdio } from "../src/codemode/stdio-lifecycle.js";

describe("closeCodeModeStdio", () => {
  afterEach(() => vi.useRealTimers());

  it("closes every resource concurrently", async () => {
    const first = { close: vi.fn(async () => undefined) };
    const second = { close: vi.fn(async () => undefined) };

    await expect(closeCodeModeStdio([first, second], 50)).resolves.toBe(true);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("reports cleanup failures without exposing their messages", async () => {
    const healthy = { close: vi.fn(async () => undefined) };
    const failing = { close: vi.fn(async () => Promise.reject(new Error("secret detail"))) };

    await expect(closeCodeModeStdio([healthy, failing], 50)).resolves.toBe(false);
  });

  it("contains synchronous cleanup failures", async () => {
    const failing = {
      close: vi.fn(() => {
        throw new Error("secret detail");
      }),
    };

    await expect(closeCodeModeStdio([failing], 50)).resolves.toBe(false);
  });

  it("bounds cleanup when a resource never settles", async () => {
    vi.useFakeTimers();
    const stuck = { close: vi.fn(() => new Promise<void>(() => undefined)) };
    const result = closeCodeModeStdio([stuck], 5_000);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe(false);
  });
});
