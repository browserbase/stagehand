import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  GEMINI_CUA_VIEWPORT,
  GeminiCuaExecutor,
  buildGeminiCuaTranscript,
  denormalizeCoordinate,
  normalizeGeminiCuaModel,
  runGeminiCuaSession,
  type GeminiCuaSessionEvent,
} from "../src/index.js";

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
})();

const FC_OPTS =
  process.env.FC_UNSEEDED === "1" ? { numRuns: NUM_RUNS } : { seed: 202604053, numRuns: NUM_RUNS };

const ASYNC_FC_OPTS =
  process.env.FC_UNSEEDED === "1"
    ? { numRuns: Math.min(NUM_RUNS, 200) }
    : { seed: 202604053, numRuns: Math.min(NUM_RUNS, 80) };

const logger = { log: () => {}, warn: () => {}, error: () => {} };

const PROTOTYPE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
] as const;

describe("gemini-cua-sdk formal properties", () => {
  describe("denormalizeCoordinate", () => {
    it("always returns a finite non-negative integer bounded by [0, size) for positive finite sizes", () => {
      const valueArb = fc.oneof(
        fc.double({ noNaN: false, noDefaultInfinity: false }),
        fc.string(),
        fc.constant(null),
        fc.constant(undefined),
        fc.boolean(),
      );
      const positiveSizeArb = fc.integer({ min: 1, max: 100_000 });

      fc.assert(
        fc.property(valueArb, positiveSizeArb, (value, size) => {
          const out = denormalizeCoordinate(value, size);
          expect(Number.isInteger(out)).toBe(true);
          expect(Object.is(out, -0)).toBe(false);
          expect(out).toBeGreaterThanOrEqual(0);
          expect(out).toBeLessThan(size);
        }),
        FC_OPTS,
      );
    });

    it("is monotonically non-decreasing in normalized coordinate input", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -500, max: 2000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -500, max: 2000, noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: 1, max: 10_000 }),
          (a, b, size) => {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            expect(denormalizeCoordinate(lo, size)).toBeLessThanOrEqual(
              denormalizeCoordinate(hi, size),
            );
          },
        ),
        FC_OPTS,
      );
    });

    it("returns 0 (never negative, NaN, Infinity, or -0) for non-positive or non-finite viewport sizes", () => {
      const badSizeArb = fc.oneof(
        fc.double({ min: -1e6, max: 0, noNaN: true, noDefaultInfinity: true }),
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
        fc.constant(Number.NEGATIVE_INFINITY),
      );
      const coordArb = fc.double({ noNaN: false, noDefaultInfinity: false });

      fc.assert(
        fc.property(coordArb, badSizeArb, (coord, size) => {
          const out = denormalizeCoordinate(coord, size);
          expect(Object.is(out, 0)).toBe(true);
        }),
        FC_OPTS,
      );
    });
  });

  describe("GeminiCuaExecutor action dispatch safety", () => {
    function assertViewportCoord(rawX: string, rawY: string): void {
      const x = Number(rawX.trim());
      const y = Number(rawY.trim());
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(GEMINI_CUA_VIEWPORT.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(GEMINI_CUA_VIEWPORT.height);
    }

    function assertEmittedCallSafety(code: string): void {
      for (const line of code.split("\n")) {
        const clickMatch = /^await batchStagehand\.page\.click\(([^,]+),\s*([^,)]+)/.exec(line);
        if (clickMatch) {
          assertViewportCoord(clickMatch[1]!, clickMatch[2]!);
          continue;
        }
        const hoverMatch = /^await batchStagehand\.page\.hover\(([^,]+),\s*([^)]+)\);$/.exec(line);
        if (hoverMatch) {
          assertViewportCoord(hoverMatch[1]!, hoverMatch[2]!);
          continue;
        }
        const scrollMatch =
          /^await batchStagehand\.page\.scroll\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);$/.exec(
            line,
          );
        if (scrollMatch) {
          assertViewportCoord(scrollMatch[1]!, scrollMatch[2]!);
          expect(Number.isFinite(Number(scrollMatch[3]!.trim()))).toBe(true);
          expect(Number.isFinite(Number(scrollMatch[4]!.trim()))).toBe(true);
          continue;
        }
        const dragMatch =
          /^await batchStagehand\.page\.dragAndDrop\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/.exec(
            line,
          );
        if (dragMatch) {
          assertViewportCoord(dragMatch[1]!, dragMatch[2]!);
          assertViewportCoord(dragMatch[3]!, dragMatch[4]!);
          continue;
        }
        const waitMatch = /^await page\.waitForTimeout\(([^)]+)\);$/.exec(line);
        if (waitMatch) {
          const ms = Number(waitMatch[1]!.trim());
          expect(Number.isFinite(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(0);
          continue;
        }
        if (line.startsWith("await batchStagehand.page.keyPress(")) {
          expect(line).not.toContain("[native code]");
          expect(line).not.toContain("function ");
        }
      }
    }

    it("never emits NaN, Infinity, or out-of-viewport coordinates for scroll/click/drag/hover/move/wait/key", async () => {
      const actionArb = fc.constantFrom(
        "click_at",
        "double_click",
        "right_click",
        "hover_at",
        "move",
        "type_text_at",
        "key_combination",
        "hotkey",
        "scroll_at",
        "scroll",
        "scroll_document",
        "navigate",
        "wait",
        "drag_and_drop",
        "unknown_action",
      );

      const inputArb = fc.record(
        {
          x: fc.oneof(fc.double({ noNaN: false, noDefaultInfinity: false }), fc.string()),
          y: fc.oneof(fc.double({ noNaN: false, noDefaultInfinity: false }), fc.string()),
          destination_x: fc.double({ noNaN: false, noDefaultInfinity: false }),
          destination_y: fc.double({ noNaN: false, noDefaultInfinity: false }),
          magnitude: fc.oneof(
            fc.double({ noNaN: false, noDefaultInfinity: false }),
            fc.constant(undefined),
          ),
          magnitude_in_pixels: fc.oneof(
            fc.double({ noNaN: false, noDefaultInfinity: false }),
            fc.constant(undefined),
          ),
          direction: fc.constantFrom("up", "down", "left", "right", "sideways"),
          seconds: fc.oneof(
            fc.double({ noNaN: false, noDefaultInfinity: false }),
            fc.constant(undefined),
          ),
          url: fc.oneof(
            fc.constant("https://example.com"),
            fc.constant("HTTPS://EXAMPLE.COM/path"),
            fc.constant("http://"),
            fc.constant("javascript:alert(1)"),
            fc.string({ maxLength: 30 }),
          ),
          keys: fc.oneof(
            fc.constantFrom(...PROTOTYPE_KEYS),
            fc.array(fc.constantFrom(...PROTOTYPE_KEYS, "ctrl", "a", ""), { maxLength: 3 }),
          ),
          text: fc.string({ maxLength: 20 }),
        },
        { requiredKeys: [] },
      );

      await fc.assert(
        fc.asyncProperty(actionArb, inputArb, async (action, input) => {
          const calls: string[] = [];
          const executor = new GeminiCuaExecutor(
            {
              run: async (code) => {
                calls.push(code);
              },
              screenshot: async () => ({ data: "UE5H", mimeType: "image/png" }),
            },
            logger,
          );

          const res = await executor.execute(action, input as Record<string, unknown>);
          expect(typeof res.text).toBe("string");
          for (const code of calls) {
            assertEmittedCallSafety(code);
          }
        }),
        ASYNC_FC_OPTS,
      );
    });

    it("always maps click, hover, move, scroll, and drag coordinates strictly inside GEMINI_CUA_VIEWPORT", async () => {
      const coordArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            "click_at",
            "double_click",
            "right_click",
            "hover_at",
            "move",
            "scroll_at",
            "drag_and_drop",
          ),
          coordArb,
          coordArb,
          coordArb,
          coordArb,
          fc.constantFrom("up", "down", "left", "right"),
          fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
          async (action, x, y, destination_x, destination_y, direction, magnitude) => {
            const calls: string[] = [];
            const executor = new GeminiCuaExecutor(
              {
                run: async (code) => {
                  calls.push(code);
                },
                screenshot: async () => ({ data: "", mimeType: "image/png" }),
              },
              logger,
            );
            const input: Record<string, unknown> =
              action === "drag_and_drop"
                ? { x, y, destination_x, destination_y }
                : action === "scroll_at"
                  ? { x, y, direction, magnitude }
                  : { x, y };
            const res = await executor.execute(action, input);
            expect(res.isError).toBeUndefined();
            expect(calls).toHaveLength(1);
            const code = calls[0]!;
            if (action === "click_at" || action === "double_click" || action === "right_click") {
              const m = /^await batchStagehand\.page\.click\(([^,]+),\s*([^,)]+)/.exec(code);
              expect(m).not.toBeNull();
              assertViewportCoord(m![1]!, m![2]!);
            } else if (action === "hover_at" || action === "move") {
              const m = /^await batchStagehand\.page\.hover\(([^,]+),\s*([^)]+)\);$/.exec(code);
              expect(m).not.toBeNull();
              assertViewportCoord(m![1]!, m![2]!);
            } else if (action === "scroll_at") {
              const m =
                /^await batchStagehand\.page\.scroll\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);$/.exec(
                  code,
                );
              expect(m).not.toBeNull();
              assertViewportCoord(m![1]!, m![2]!);
              expect(Number.isFinite(Number(m![3]!.trim()))).toBe(true);
              expect(Number.isFinite(Number(m![4]!.trim()))).toBe(true);
            } else {
              const m =
                /^await batchStagehand\.page\.dragAndDrop\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/.exec(
                  code,
                );
              expect(m).not.toBeNull();
              assertViewportCoord(m![1]!, m![2]!);
              assertViewportCoord(m![3]!, m![4]!);
            }
          },
        ),
        ASYNC_FC_OPTS,
      );
    });

    it("rejects non-finite or negative scroll magnitudes instead of emitting broken JS", async () => {
      const badMagArb = fc.oneof(
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
        fc.constant(Number.NEGATIVE_INFINITY),
        fc.double({ min: -10_000, max: -0.01, noNaN: true, noDefaultInfinity: true }),
      );

      await fc.assert(
        fc.asyncProperty(badMagArb, async (magnitude) => {
          const calls: string[] = [];
          const executor = new GeminiCuaExecutor(
            {
              run: async (code) => {
                calls.push(code);
              },
              screenshot: async () => ({ data: "", mimeType: "image/png" }),
            },
            logger,
          );
          const res = await executor.execute("scroll_at", {
            x: 500,
            y: 500,
            direction: "down",
            magnitude,
          });
          expect(res.isError).toBe(true);
          expect(calls).toEqual([]);
        }),
        ASYNC_FC_OPTS,
      );
    });
  });

  describe("transcript and session invariants", () => {
    it("buildGeminiCuaTranscript clips Unicode text without splitting UTF-16 surrogate pairs", () => {
      const emojiPayloadArb = fc
        .tuple(fc.integer({ min: 1990, max: 2005 }), fc.string({ maxLength: 40 }))
        .map(([n, tail]) => `${"x".repeat(n)}🧪🔥${tail}`);

      fc.assert(
        fc.property(
          fc.oneof(fc.string({ maxLength: 2500 }), emojiPayloadArb),
          fc.boolean(),
          (text, error) => {
            const events: GeminiCuaSessionEvent[] = [
              {
                type: "tool_result",
                turn: 1,
                id: "c1",
                name: "click_at",
                text,
                error,
              },
            ];
            const rendered = buildGeminiCuaTranscript(events);
            expect(Buffer.from(rendered, "utf8").toString("utf8")).toBe(rendered);
            expect(rendered).toContain('<tool_result name="click_at"');
          },
        ),
        FC_OPTS,
      );
    });

    it("runGeminiCuaSession keeps token usage non-negative, pairs tool calls, and handles null throws", async () => {
      const usageNumArb = fc.oneof(
        fc.constant(undefined),
        fc.integer({ min: -100, max: 100_000 }),
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
      );

      await fc.assert(
        fc.asyncProperty(
          usageNumArb,
          usageNumArb,
          usageNumArb,
          usageNumArb,
          fc.array(fc.stringMatching(/^[a-z_]{1,12}$/), { minLength: 1, maxLength: 4 }),
          async (promptTokens, candidateTokens, thoughtTokens, cachedTokens, callNames) => {
            let turn = 0;
            const result = await runGeminiCuaSession({
              prompt: "go",
              model: normalizeGeminiCuaModel("google/gemini-3.8-flash"),
              logger,
              maxTurns: 3,
              tools: { execute: async (name) => ({ text: `${name} ok` }) },
              facade: {
                run: async () => "https://example.com",
                screenshot: async () => ({ data: "UE5H", mimeType: "image/png" }),
              },
              client: {
                generateContent: async () => {
                  turn += 1;
                  if (turn === 1) {
                    return {
                      candidates: [
                        {
                          finishReason: "STOP",
                          content: {
                            parts: callNames.map((name, i) => ({
                              functionCall: { id: `call_${i}`, name, args: {} },
                            })),
                          },
                        },
                      ],
                      usageMetadata: {
                        promptTokenCount: promptTokens,
                        candidatesTokenCount: candidateTokens,
                        thoughtsTokenCount: thoughtTokens,
                        cachedContentTokenCount: cachedTokens,
                      },
                    };
                  }
                  return {
                    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "done" }] } }],
                    usageMetadata: {},
                  };
                },
              },
            });

            expect(result.status).toBe("completed");
            for (const val of Object.values(result.tokenUsage)) {
              expect(Number.isFinite(val) && val >= 0).toBe(true);
            }
            const uses = result.events.filter((e) => e.type === "tool_use");
            const results = result.events.filter((e) => e.type === "tool_result");
            expect(uses.length).toBe(callNames.length);
            expect(results.length).toBe(callNames.length);
            expect(uses.map((u) => u.id)).toEqual(results.map((r) => r.id));
          },
        ),
        ASYNC_FC_OPTS,
      );

      await fc.assert(
        fc.asyncProperty(fc.constantFrom(null, undefined, "raw-error", 404), async (thrown) => {
          const result = await runGeminiCuaSession({
            prompt: "go",
            model: "gemini-3.8-flash",
            logger,
            maxTurns: 1,
            tools: { execute: async () => ({ text: "ok" }) },
            facade: {
              run: async () => "",
              screenshot: async () => ({ data: "", mimeType: "image/png" }),
            },
            client: {
              generateContent: async () => {
                throw thrown;
              },
            },
          });
          expect(result.status).toBe("sdk_error");
          expect(result.stopReason).not.toContain("Cannot read properties");
        }),
        { numRuns: 10 },
      );
    });
  });
});
