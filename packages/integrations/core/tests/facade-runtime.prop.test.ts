import type { Stagehand } from "@browserbasehq/stagehand";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { closeCodeModeStdio } from "../src/codemode/stdio-lifecycle.js";
import { RUN_EPILOGUE, RUN_PRELUDE, runCallback } from "../src/facade/batch-sources.js";
import { canonicalJson } from "../src/facade/bundle.js";
import {
  DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
  MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
  StagehandFacadeConfigError,
  stagehandFacadeConfigFromEnv,
} from "../src/facade/config.js";
import {
  browserSessionLostError,
  CodeModeRunInputSchema,
  facadeSurfaceFromArgs,
  isBrowserSessionLostError,
  RUN_RESULT_MALFORMED_ERROR,
  screenshotArtifactWriteError,
  staleSnapshotIdError,
} from "../src/facade/contract.js";
import { transportSafeText } from "../src/facade/output.js";
import {
  captureScreenshotWithinBase64Budget,
  imageDimensions,
  screenshotBase64BudgetFromArgs,
  type ScreenshotOptions,
} from "../src/facade/screenshot-transport.js";
import {
  StagehandFacadeExecutionError,
  StagehandFacadeInputError,
  StagehandFacadeTools,
} from "../src/facade/tools.js";

function isWellFormedUtf16(value: string): boolean {
  return (value as string & { isWellFormed(): boolean }).isWellFormed();
}

function makePngBase64(width: number, height: number): string {
  const b = Buffer.alloc(24);
  b.write("\x89PNG\r\n\x1a\n", 0, "binary");
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString("base64");
}

function makeJpegBase64(width: number, height: number, extraFillBytes = 0): string {
  const fill = Array.from({ length: extraFillBytes }, () => 0xff);
  const b = Buffer.from([
    0xff,
    0xd8,
    ...fill,
    0xff,
    0xe0,
    0x00,
    0x02,
    ...fill,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  return b.toString("base64");
}

describe("facade runtime, transport, config, contract, and lifecycle properties (fast-check)", () => {
  it("transportSafeText strips U+0085/U+2028/U+2029, is idempotent, preserves UTF-16 well-formedness and JSON round-trip", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 100 }), (raw) => {
        const text = `${raw}\u0085\u2028\u2029\\u2028`;
        const safe = transportSafeText(text);
        expect(safe).not.toMatch(/[\u0085\u2028\u2029]/u);
        expect(transportSafeText(safe)).toBe(safe);
        expect(isWellFormedUtf16(safe)).toBe(true);
      }),
      { numRuns: 300 },
    );

    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.constantFrom("\u0085", "\u2028", "\u2029", "\\\u2028", "🏈\u2029"),
        (value, sep) => {
          const wrapped = { value, sep };
          const serialized = transportSafeText(JSON.stringify(wrapped));
          expect(serialized).not.toMatch(/[\u0085\u2028\u2029]/u);
          expect(JSON.parse(serialized)).toEqual(JSON.parse(JSON.stringify(wrapped)));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("imageDimensions decodes valid PNG/JPEG (including 0xFF marker padding) and never crashes or hangs on arbitrary bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65_535 }),
        fc.integer({ min: 1, max: 65_535 }),
        fc.integer({ min: 0, max: 4 }),
        (width, height, fillBytes) => {
          expect(
            imageDimensions({ data: makePngBase64(width, height), mimeType: "image/png" }),
          ).toStrictEqual({ width, height });
          expect(
            imageDimensions({
              data: makeJpegBase64(width, height, fillBytes),
              mimeType: "image/jpeg",
            }),
          ).toStrictEqual({ width, height });
        },
      ),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 128 }),
        fc.constantFrom("image/png" as const, "image/jpeg" as const),
        (bytes, mimeType) => {
          const dims = imageDimensions({
            data: Buffer.from(bytes).toString("base64"),
            mimeType,
          });
          if (dims !== undefined) {
            expect(dims.width).toBeGreaterThanOrEqual(0);
            expect(dims.height).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 400 },
    );

    const corruptLengthZeroJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20,
    ]).toString("base64");
    expect(
      imageDimensions({ data: corruptLengthZeroJpeg, mimeType: "image/jpeg" }),
    ).toBeUndefined();

    const fakePng = Buffer.alloc(24);
    fakePng.write("\x00PNG", 0, "binary");
    expect(
      imageDimensions({ data: fakePng.toString("base64"), mimeType: "image/png" }),
    ).toBeUndefined();
  });

  it("screenshotBase64BudgetFromArgs strictly validates decimal integer budgets >= 1024", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_024, max: 100_000_000 }), (budget) => {
        expect(screenshotBase64BudgetFromArgs([`--max-screenshot-base64-bytes=${budget}`])).toBe(
          budget,
        );
      }),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10_000, max: 1_023 }).map(String),
          fc.constantFrom("0x400", "1e4", " 2048 ", "+2048", "2048.5", "", "NaN", "Infinity"),
        ),
        (bad) => {
          expect(() =>
            screenshotBase64BudgetFromArgs([`--max-screenshot-base64-bytes=${bad}`]),
          ).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("captureScreenshotWithinBase64Budget always obeys byte & side limits and never increases JPEG quality", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          fullPage: fc.option(fc.boolean(), { nil: undefined }),
          type: fc.option(fc.constantFrom("png" as const, "jpeg" as const), { nil: undefined }),
          quality: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
        }),
        fc.integer({ min: 1_024, max: 50_000 }),
        fc.integer({ min: 100, max: 4_000 }),
        async (requested, maxBytes, maxSidePx) => {
          const observedQualities: number[] = [];
          const capture = async (options: ScreenshotOptions) => {
            if (options.type === "jpeg" && options.quality !== undefined) {
              observedQualities.push(options.quality);
            }
            const width = options.fullPage ? maxSidePx + 500 : Math.min(800, maxSidePx);
            const height = options.fullPage ? maxSidePx + 500 : Math.min(600, maxSidePx);
            const data =
              options.type === "png"
                ? makePngBase64(width, height)
                : makeJpegBase64(width, height, 1);
            return {
              data,
              mimeType: options.type === "png" ? ("image/png" as const) : ("image/jpeg" as const),
            };
          };

          const result = await captureScreenshotWithinBase64Budget(
            capture,
            requested,
            maxBytes,
            maxSidePx,
          );
          expect(Buffer.byteLength(result.image.data, "utf8")).toBeLessThanOrEqual(maxBytes);
          const dims = imageDimensions(result.image);
          if (dims !== undefined) {
            expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(maxSidePx);
          }
          if (requested.type === "jpeg" && requested.quality !== undefined) {
            for (const q of observedQualities) {
              expect(q).toBeLessThanOrEqual(requested.quality);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("stagehandFacadeConfigFromEnv validates timeouts, booleans, and browser types deterministically", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS }),
        fc.constantFrom("1", "true", "yes", "on", "0", "false", "no", "off"),
        (timeout, flag) => {
          const env = {
            BROWSERBASE_API_KEY: "bb_live_1234567890",
            STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: String(timeout),
            STAGEHAND_BROWSERBASE_PROXIES: flag,
            STAGEHAND_FACADE_QUIET_WAIT: flag,
          };
          const a = stagehandFacadeConfigFromEnv(env);
          const b = stagehandFacadeConfigFromEnv(env);
          expect(a).toStrictEqual(b);
          expect(a.browser.type).toBe("browserbase");
          if (a.browser.type === "browserbase") {
            expect(a.browser.launchOptions.timeout).toBe(timeout);
          }
        },
      ),
      { numRuns: 100 },
    );

    const defaultBb = stagehandFacadeConfigFromEnv({ BROWSERBASE_API_KEY: "bb_live_1234567890" });
    expect(defaultBb.browser.type).toBe("browserbase");
    if (defaultBb.browser.type === "browserbase") {
      expect(defaultBb.browser.launchOptions.timeout).toBe(
        DEFAULT_BROWSERBASE_SESSION_TIMEOUT_SECONDS,
      );
    }

    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 59 }).map(String),
          fc
            .integer({ min: MAX_BROWSERBASE_SESSION_TIMEOUT_SECONDS + 1, max: 1_000_000 })
            .map(String),
          fc.constantFrom("60.5", "1e3", "0x64", "abc"),
        ),
        (badTimeout) => {
          expect(() =>
            stagehandFacadeConfigFromEnv({
              BROWSERBASE_API_KEY: "bb_live_1234567890",
              STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: badTimeout,
            }),
          ).toThrow(StagehandFacadeConfigError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("contract error builders preserve literal $&/$$/$' strings and CodeModeRunInputSchema enforces strict XOR", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 40 }),
          fc.constantFrom("$&", "$$", "$`", "$'", "$1", "${id}", "${cause}"),
        ),
        (token) => {
          expect(staleSnapshotIdError(token)).toBe(
            `Snapshot ID "${token}" is stale or not actionable; call snapshot again.`,
          );
          expect(screenshotArtifactWriteError(token)).toBe(
            `Screenshot artifact could not be written (${token}).`,
          );
          const lost = browserSessionLostError(token);
          expect(lost).toBe(
            `Browser session lost (${token}). The task cannot continue; report your final result now.`,
          );
          expect(isBrowserSessionLostError(lost)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (code, id) => {
          expect(CodeModeRunInputSchema.safeParse({ code }).success).toBe(true);
          expect(CodeModeRunInputSchema.safeParse({ actions: [{ op: "click", id }] }).success).toBe(
            true,
          );
          expect(CodeModeRunInputSchema.safeParse({}).success).toBe(false);
          expect(
            CodeModeRunInputSchema.safeParse({ code, actions: [{ op: "click", id }] }).success,
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }).filter((s) => s !== "playwright" && s !== "legacy"),
        (invalid) => {
          expect(() => facadeSurfaceFromArgs([`--surface=${invalid}`])).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("canonicalJson is key-order invariant and always emits valid JSON even with undefined array entries", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue(), { maxKeys: 10 }),
        (obj) => {
          const reversed = Object.fromEntries(Object.entries(obj).reverse());
          const c1 = canonicalJson(obj);
          const c2 = canonicalJson(reversed);
          expect(c1).toBe(c2);
          expect(JSON.parse(c1)).toEqual(obj);
        },
      ),
      { numRuns: 200 },
    );

    const withUndefined = canonicalJson([1, undefined, { a: 1, b: undefined }]);
    expect(() => JSON.parse(withUndefined)).not.toThrow();
    expect(JSON.parse(withUndefined)).toEqual([1, null, { a: 1 }]);
  });

  it("runCallback rejects callback-closing syntax injections and wraps valid code deterministically", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "})(); } catch {} }, (globalThis.__fvEsc = 1), (async () => {",
          "return 1; }",
          "})();",
          "/* unterminated",
          "return 1; });",
        ),
        (malicious) => {
          expect(() => runCallback(malicious)).toThrow(SyntaxError);
        },
      ),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(fc.integer(), (n) => {
        const code = `return ${n};`;
        const fn = runCallback(code);
        expect(Function.prototype.toString.call(fn)).toBe(RUN_PRELUDE + code + RUN_EPILOGUE);
      }),
      { numRuns: 50 },
    );
  });

  it("closeCodeModeStdio never leaks unhandled rejections or timers across arbitrary resource outcomes and edge timeouts", async () => {
    const unhandled: unknown[] = [];
    const warnings: Error[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("unhandledRejection", onUnhandled);
    process.on("warning", onWarning);
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom("ok", "reject", "throw", "hang"), { maxLength: 5 }),
          fc.constantFrom(0, 5, 10, -1, Number.NaN),
          async (kinds, timeoutMs) => {
            const resources = kinds.map((kind) => ({
              close: () => {
                switch (kind) {
                  case "ok":
                    return Promise.resolve();
                  case "reject":
                    return Promise.reject(new Error("boom"));
                  case "throw":
                    throw new Error("sync boom");
                  case "hang":
                    return new Promise<void>(() => undefined);
                  default: {
                    const exhaustive: never = kind;
                    return exhaustive;
                  }
                }
              },
            }));
            const effectiveTimeout = Number.isNaN(timeoutMs) ? 10 : timeoutMs;
            const result = await closeCodeModeStdio(resources, effectiveTimeout);
            const expected = kinds.every((k) => k === "ok");
            if (expected && effectiveTimeout >= 5) {
              expect(result).toBe(true);
            }
            if (!expected) {
              expect(result).toBe(false);
            }
          },
        ),
        { numRuns: 40 },
      );

      const fast = { close: async () => undefined };
      await expect(closeCodeModeStdio([fast], Number.POSITIVE_INFINITY)).resolves.toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(unhandled).toEqual([]);
      expect(warnings.filter((w) => w.name === "TimeoutOverflowWarning")).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      process.off("warning", onWarning);
    }
  });

  it("StagehandFacadeTools rejects malformed run envelopes (including NaN/Infinity batchRuntimeMs) and sanitizes execution errors", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.constant({
            __stagehandPlaywrightCompat: true,
            value: 1,
            telemetry: {},
            artifacts: [],
            closeRequested: false,
            batchRuntimeMs: Number.NaN,
          }),
          fc.constant({
            __stagehandPlaywrightCompat: true,
            value: 1,
            telemetry: {},
            artifacts: [],
            closeRequested: false,
            batchRuntimeMs: Number.POSITIVE_INFINITY,
          }),
          fc.constant({
            __stagehandPlaywrightCompat: true,
            value: 1,
            telemetry: {},
            artifacts: [{ path: "a.png", base64: "not-base64!" }],
            closeRequested: false,
            batchRuntimeMs: 1,
          }),
        ),
        async (malformed) => {
          const page = { pageId: "p1", url: async () => "about:blank" };
          const closeSpy = vi.fn(async () => undefined);
          const stagehand = {
            browser: {
              context: {
                activePage: vi.fn(async () => page),
                pages: vi.fn(async () => [page]),
                setActivePage: vi.fn(async () => undefined),
              },
              close: vi.fn(async () => undefined),
            },
            close: closeSpy,
            experimentalBatch: vi.fn(async () => malformed),
          } as unknown as Stagehand;

          const tools = new StagehandFacadeTools(stagehand, { keeperPage: false });
          await expect(tools.run("return 1;")).rejects.toThrow(
            new StagehandFacadeInputError(RUN_RESULT_MALFORMED_ERROR),
          );
          expect(closeSpy).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (name, msg) => {
        const err = new StagehandFacadeExecutionError({
          name,
          message: `${msg} sk-abcdef1234567890secret`,
        });
        expect(err.name).toMatch(/^(?:[A-Za-z][A-Za-z0-9]*)?Error$/u);
        expect(err.message).not.toContain("1234567890secret");
        expect(err.stack).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
