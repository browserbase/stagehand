import { describe, expect, it } from "vite-plus/test";
import {
  PageAddInitScriptParamsSchema,
  PageClickParamsSchema,
  PageDragAndDropParamsSchema,
  PageDragAndDropResultSchema,
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
  PageGoBackParamsSchema,
  PageGoForwardParamsSchema,
  PageHoverParamsSchema,
  PageKeyPressParamsSchema,
  PageReloadParamsSchema,
  PageScreenshotParamsSchema,
  PageScreenshotResultSchema,
  PageScrollParamsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParamsSchema,
  PageSnapshotParamsSchema,
  PageTypeParamsSchema,
  PageWaitForLoadStateParamsSchema,
  PageWaitForSelectorParamsSchema,
  PageWaitForSelectorResultSchema,
  PageWaitForTimeoutParamsSchema,
} from "../../schemas.js";

const pageId = "page-1";

describe("page command schemas", () => {
  it("defines navigation params", () => {
    expect(
      PageReloadParamsSchema.parse({
        pageId,
        options: { waitUntil: "load", timeoutMs: 5_000, ignoreCache: true },
      }),
    ).toStrictEqual({
      pageId,
      options: { waitUntil: "load", timeoutMs: 5_000, ignoreCache: true },
    });
    expect(PageGoBackParamsSchema.parse({ pageId })).toStrictEqual({ pageId });
    expect(
      PageGoForwardParamsSchema.parse({
        pageId,
        options: { waitUntil: "networkidle" },
      }),
    ).toStrictEqual({ pageId, options: { waitUntil: "networkidle" } });
    expect(() =>
      PageGoBackParamsSchema.parse({ pageId, options: { ignoreCache: true } }),
    ).toThrow();
  });

  it("defines coordinate interaction params and results", () => {
    expect(
      PageClickParamsSchema.parse({
        pageId,
        x: 10,
        y: 20,
        options: { button: "right", clickCount: 2, returnXpath: true },
      }),
    ).toStrictEqual({
      pageId,
      x: 10,
      y: 20,
      options: { button: "right", clickCount: 2, returnXpath: true },
    });
    expect(PageHoverParamsSchema.parse({ pageId, x: -1, y: 0 })).toStrictEqual({
      pageId,
      x: -1,
      y: 0,
    });
    expect(
      PageScrollParamsSchema.parse({
        pageId,
        x: 100,
        y: 200,
        deltaX: -10,
        deltaY: 400,
        options: { returnXpath: true },
      }),
    ).toStrictEqual({
      pageId,
      x: 100,
      y: 200,
      deltaX: -10,
      deltaY: 400,
      options: { returnXpath: true },
    });
    expect(
      PageDragAndDropParamsSchema.parse({
        pageId,
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        options: { steps: 5, delay: 10 },
      }),
    ).toStrictEqual({
      pageId,
      fromX: 1,
      fromY: 2,
      toX: 3,
      toY: 4,
      options: { steps: 5, delay: 10 },
    });
    expect(
      PageDragAndDropResultSchema.parse({ fromXpath: "/html/body/a", toXpath: "/html/body/b" }),
    ).toStrictEqual({ fromXpath: "/html/body/a", toXpath: "/html/body/b" });
    expect(() =>
      PageClickParamsSchema.parse({ pageId, x: 1, y: 2, options: { clickCount: 0 } }),
    ).toThrow();
  });

  it("defines keyboard interaction params with current v3 option names", () => {
    expect(
      PageTypeParamsSchema.parse({
        pageId,
        text: "hello",
        options: { delay: 5, withMistakes: true },
      }),
    ).toStrictEqual({
      pageId,
      text: "hello",
      options: { delay: 5, withMistakes: true },
    });
    expect(PageKeyPressParamsSchema.parse({ pageId, key: "Control+A" })).toStrictEqual({
      pageId,
      key: "Control+A",
    });
    expect(() =>
      PageTypeParamsSchema.parse({ pageId, text: "hello", options: { mistakes: true } }),
    ).toThrow();
  });

  it("defines normalized script params and JSON evaluation results", () => {
    expect(
      PageEvaluateParamsSchema.parse({ pageId, expression: "({ camelCase: true })" }),
    ).toStrictEqual({ pageId, expression: "({ camelCase: true })" });
    expect(PageEvaluateResultSchema.parse({ value: { camelCase: true } })).toStrictEqual({
      value: { camelCase: true },
    });
    expect(
      PageAddInitScriptParamsSchema.parse({ pageId, source: "globalThis.ready = true" }),
    ).toStrictEqual({ pageId, source: "globalThis.ready = true" });
    expect(() => PageEvaluateResultSchema.parse({ value: undefined })).toThrow();
  });

  it("defines headers, viewport, and wait params", () => {
    expect(
      PageSetExtraHTTPHeadersParamsSchema.parse({
        pageId,
        headers: { "X-Request-ID": "request-1" },
      }),
    ).toStrictEqual({ pageId, headers: { "X-Request-ID": "request-1" } });
    expect(
      PageSetViewportSizeParamsSchema.parse({
        pageId,
        width: 1280,
        height: 720,
        options: { deviceScaleFactor: 2 },
      }),
    ).toStrictEqual({
      pageId,
      width: 1280,
      height: 720,
      options: { deviceScaleFactor: 2 },
    });
    expect(
      PageWaitForLoadStateParamsSchema.parse({
        pageId,
        state: "domcontentloaded",
        timeoutMs: 0,
      }),
    ).toStrictEqual({ pageId, state: "domcontentloaded", timeoutMs: 0 });
    expect(PageWaitForTimeoutParamsSchema.parse({ pageId, ms: 250 })).toStrictEqual({
      pageId,
      ms: 250,
    });
    expect(
      PageWaitForSelectorParamsSchema.parse({
        pageId,
        selector: "button.submit",
        options: { state: "visible", timeout: 1_000, pierceShadow: false },
      }),
    ).toStrictEqual({
      pageId,
      selector: "button.submit",
      options: { state: "visible", timeout: 1_000, pierceShadow: false },
    });
    expect(PageWaitForSelectorResultSchema.parse({ matched: true })).toStrictEqual({
      matched: true,
    });
    expect(() =>
      PageSetViewportSizeParamsSchema.parse({ pageId, width: 0, height: 720 }),
    ).toThrow();
  });

  it("defines wire-safe screenshot and snapshot params", () => {
    expect(
      PageScreenshotParamsSchema.parse({
        pageId,
        options: {
          type: "jpeg",
          quality: 80,
          clip: { x: 0, y: 0, width: 640, height: 480 },
          mask: [{ pageId, selector: "[data-secret]", nth: 0 }],
        },
      }),
    ).toStrictEqual({
      pageId,
      options: {
        type: "jpeg",
        quality: 80,
        clip: { x: 0, y: 0, width: 640, height: 480 },
        mask: [{ pageId, selector: "[data-secret]", nth: 0 }],
      },
    });
    expect(PageScreenshotResultSchema.parse({ data: "iVBORw==", type: "png" })).toStrictEqual({
      data: "iVBORw==",
      type: "png",
    });
    expect(
      PageSnapshotParamsSchema.parse({ pageId, options: { includeIframes: true } }),
    ).toStrictEqual({ pageId, options: { includeIframes: true } });
    expect(() =>
      PageScreenshotParamsSchema.parse({ pageId, options: { type: "png", quality: 80 } }),
    ).toThrow();
    expect(() =>
      PageScreenshotParamsSchema.parse({
        pageId,
        options: {
          fullPage: true,
          clip: { x: 0, y: 0, width: 640, height: 480 },
        },
      }),
    ).toThrow();
    expect(() =>
      PageScreenshotParamsSchema.parse({ pageId, options: { path: "screenshot.png" } }),
    ).toThrow();
  });
});
