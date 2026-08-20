import { describe, expect, it, vi } from "vitest";
import {
  captureScreenshotWithinBase64Budget,
  screenshotBase64BudgetFromArgs,
  type ScreenshotOptions,
} from "../src/facade/screenshot-transport.js";

describe("facade screenshot transport", () => {
  it("parses an optional base64 budget", () => {
    expect(screenshotBase64BudgetFromArgs([])).toBeUndefined();
    expect(screenshotBase64BudgetFromArgs(["--max-screenshot-base64-bytes=60000"])).toBe(60_000);
    expect(() => screenshotBase64BudgetFromArgs(["--max-screenshot-base64-bytes=1000"])).toThrow(
      "must be an integer of at least 1024",
    );
  });

  it("defaults budgeted captures to a viewport jpeg", async () => {
    const capture = vi.fn(async (options: ScreenshotOptions) => ({
      data: "a".repeat(1_000),
      mimeType: options.type === "jpeg" ? ("image/jpeg" as const) : ("image/png" as const),
    }));

    const result = await captureScreenshotWithinBase64Budget(capture, {}, 60_000);

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({ fullPage: false, type: "jpeg", quality: 40 });
    expect(result.adjusted).toBe(true);
    expect(result.image.mimeType).toBe("image/jpeg");
  });

  it("preserves an explicit image when it fits", async () => {
    const capture = vi.fn(async () => ({
      data: "a".repeat(1_000),
      mimeType: "image/png" as const,
    }));
    const requested = { fullPage: true, type: "png" as const };

    const result = await captureScreenshotWithinBase64Budget(capture, requested, 60_000);

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(requested);
    expect(result.adjusted).toBe(false);
  });

  it("retries an oversized image as progressively smaller viewport jpegs", async () => {
    const capture = vi.fn(async (options: ScreenshotOptions) => ({
      data: "a".repeat(options.quality === 25 ? 50_000 : 90_000),
      mimeType: options.type === "jpeg" ? ("image/jpeg" as const) : ("image/png" as const),
    }));

    const result = await captureScreenshotWithinBase64Budget(
      capture,
      { fullPage: true, type: "png" },
      60_000,
    );

    expect(capture.mock.calls.map(([options]) => options)).toStrictEqual([
      { fullPage: true, type: "png" },
      { fullPage: false, type: "jpeg", quality: 40 },
      { fullPage: false, type: "jpeg", quality: 25 },
    ]);
    expect(result.options).toStrictEqual({ fullPage: false, type: "jpeg", quality: 25 });
    expect(result.adjusted).toBe(true);
  });

  it("never increases an explicitly requested jpeg quality during retries", async () => {
    const capture = vi.fn(async (options: ScreenshotOptions) => ({
      data: "a".repeat(options.quality === 10 ? 50_000 : 90_000),
      mimeType: "image/jpeg" as const,
    }));

    const result = await captureScreenshotWithinBase64Budget(
      capture,
      { fullPage: true, type: "jpeg", quality: 20 },
      60_000,
    );

    expect(capture.mock.calls.map(([options]) => options)).toStrictEqual([
      { fullPage: true, type: "jpeg", quality: 20 },
      { fullPage: false, type: "jpeg", quality: 20 },
      { fullPage: false, type: "jpeg", quality: 10 },
    ]);
    expect(result.options).toStrictEqual({ fullPage: false, type: "jpeg", quality: 10 });
  });

  it("throws a small error instead of returning an oversized frame", async () => {
    const capture = vi.fn(async () => ({
      data: "a".repeat(90_000),
      mimeType: "image/jpeg" as const,
    }));

    await expect(captureScreenshotWithinBase64Budget(capture, {}, 60_000)).rejects.toThrow(
      "Screenshot exceeds the 60000-byte MCP transport budget",
    );
    expect(capture).toHaveBeenCalledTimes(3);
  });
});
