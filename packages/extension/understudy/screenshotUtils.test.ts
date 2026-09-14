import { trace } from "@opentelemetry/api";
import { Frame } from "./frame.js";
import { StagehandLogger } from "../logger.js";
import { describe, expect, it, vi } from "vitest";
import { withScreenshotLock } from "./screenshotUtils.js";

function connection() {
  return { send: vi.fn(), on: vi.fn(), off: vi.fn(), close: vi.fn(), id: null };
}

function captureGate() {
  let release!: (value: Uint8Array) => void;
  const pending = new Promise<Uint8Array>((resolve) => {
    release = resolve;
  });
  return { pending, release: () => release(new Uint8Array([1])) };
}

describe("screenshot serialization", () => {
  it("keeps another page's capture queued until the first finishes", async () => {
    const browser = connection();
    const first = captureGate();
    const nextCapture = vi.fn(async () => new Uint8Array([2]));
    const a = withScreenshotLock(browser, () => first.pending, undefined);
    const b = withScreenshotLock(browser, nextCapture, undefined);
    await Promise.resolve();
    expect(nextCapture).not.toHaveBeenCalled();
    first.release();
    await expect(a).resolves.toEqual(new Uint8Array([1]));
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });

  it("does not block a different browser", async () => {
    const first = captureGate();
    const a = withScreenshotLock(connection(), () => first.pending, undefined);
    try {
      await expect(
        withScreenshotLock(connection(), async () => new Uint8Array([2]), undefined),
      ).resolves.toEqual(new Uint8Array([2]));
    } finally {
      first.release();
      await a;
    }
  });

  it("continues after a failed capture", async () => {
    const browser = connection();
    const a = withScreenshotLock(
      browser,
      async () => {
        throw new Error("capture failed");
      },
      undefined,
    );
    const b = withScreenshotLock(browser, async () => new Uint8Array([2]), undefined);
    await expect(a).rejects.toThrow("capture failed");
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });

  it("releases a stalled capture only after cleanup, ignoring its late response", async () => {
    vi.useFakeTimers();
    const browser = connection();
    let respond!: (value: { data: string }) => void;
    const response = new Promise<{ data: string }>((resolve) => {
      respond = resolve;
    });
    browser.send.mockImplementation(async (method: string) =>
      method === "Page.captureScreenshot" ? response : {},
    );
    const frame = new Frame(
      browser,
      "frame",
      "page",
      false,
      new StagehandLogger({ tracer: trace.getTracer("screenshot-test") }, () => {}),
    );
    const cleanup = captureGate();
    const cleanupStarted = vi.fn();
    const first = withScreenshotLock(
      browser,
      async (signal) => {
        try {
          return await frame.screenshot({ signal });
        } finally {
          cleanupStarted();
          await cleanup.pending;
        }
      },
      10,
    );
    const nextCapture = vi.fn(async () => new Uint8Array([2]));
    const second = withScreenshotLock(browser, nextCapture, undefined);
    const timedOut = expect(first).rejects.toThrow(/screenshot.*timed out/i);
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(browser.send).toHaveBeenCalledWith("Page.captureScreenshot", expect.any(Object));
      expect(cleanupStarted).toHaveBeenCalledOnce();
      expect(nextCapture).not.toHaveBeenCalled();
      cleanup.release();
      await expect(second).resolves.toEqual(new Uint8Array([2]));
      respond({ data: "AQ==" });
      await vi.advanceTimersByTimeAsync(0);
      expect(cleanupStarted).toHaveBeenCalledOnce();
      expect(nextCapture).toHaveBeenCalledOnce();
    } finally {
      cleanup.release();
      respond({ data: "AQ==" });
      vi.useRealTimers();
    }
  });

  it("does not activate a queued page after its timeout", async () => {
    vi.useFakeTimers();
    const browser = connection();
    const first = captureGate();
    const a = withScreenshotLock(browser, () => first.pending, undefined);
    const nextCapture = vi.fn(async () => new Uint8Array([2]));
    const b = withScreenshotLock(browser, nextCapture, 10);
    const timedOut = expect(b).rejects.toThrow(/screenshot.*timed out/i);
    try {
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      first.release();
      await a;
      await withScreenshotLock(browser, async () => new Uint8Array([3]), undefined);
      expect(nextCapture).not.toHaveBeenCalled();
    } finally {
      first.release();
      vi.useRealTimers();
    }
  });
});
