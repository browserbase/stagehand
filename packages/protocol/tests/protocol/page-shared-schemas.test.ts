import { describe, expect, it } from "vite-plus/test";
import {
  LoadStateSchema,
  PageCoordinateResultSchema,
  PageNavigationOptionsSchema,
  PageScreenshotClipSchema,
  PageSnapshotOptionsSchema,
  PageVoidResultSchema,
  SnapshotResultSchema,
} from "../../schemas.js";

describe("shared page protocol schemas", () => {
  it("parses navigation options and rejects unsupported load states", () => {
    expect(
      PageNavigationOptionsSchema.parse({
        waitUntil: "domcontentloaded",
        timeoutMs: 10_000,
      }),
    ).toStrictEqual({
      waitUntil: "domcontentloaded",
      timeoutMs: 10_000,
    });
    expect(() => LoadStateSchema.parse("commit")).toThrow();
    expect(() => PageNavigationOptionsSchema.parse({ timeoutMs: 0 })).toThrow();
  });

  it("keeps command result schemas strict", () => {
    expect(PageVoidResultSchema.parse({ ok: true })).toStrictEqual({ ok: true });
    expect(PageCoordinateResultSchema.parse({ xpath: "/html/body/button" })).toStrictEqual({
      xpath: "/html/body/button",
    });
    expect(() => PageVoidResultSchema.parse({ ok: true, extra: true })).toThrow();
  });

  it("validates screenshot clips", () => {
    expect(PageScreenshotClipSchema.parse({ x: -10, y: 0, width: 640, height: 480 })).toStrictEqual(
      { x: -10, y: 0, width: 640, height: 480 },
    );
    expect(() => PageScreenshotClipSchema.parse({ x: 0, y: 0, width: 0, height: 480 })).toThrow();
  });

  it("parses snapshot options and results", () => {
    expect(PageSnapshotOptionsSchema.parse({ includeIframes: true })).toStrictEqual({
      includeIframes: true,
    });
    expect(
      SnapshotResultSchema.parse({
        formattedTree: "root",
        xpathMap: { "1": "/html/body" },
        urlMap: { "1": "https://example.com" },
      }),
    ).toStrictEqual({
      formattedTree: "root",
      xpathMap: { "1": "/html/body" },
      urlMap: { "1": "https://example.com" },
    });
  });
});
