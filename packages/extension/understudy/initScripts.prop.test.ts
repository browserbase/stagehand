import vm from "node:vm";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { InitScriptSource } from "../types/private/index.js";
import { normalizeInitScriptSource } from "./initScripts.js";

const BASE_SEED = 20261124;

const jsonArgArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.string({ maxLength: 40 }),
  fc.constantFrom('"</script><script>alert(1)</script>', "a\\b'c\"d\ne\rf\t", "\u2028\u2029"),
  fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 12 }), fc.boolean(), fc.constant(null)), {
    maxLength: 5,
  }),
  fc.dictionary(
    fc.stringMatching(/^[a-z]{1,6}$/),
    fc.oneof(fc.integer(), fc.string({ maxLength: 8 })),
    { maxKeys: 4, noNullPrototype: true },
  ),
);

describe("initScripts adversarial properties", () => {
  it("produces executable JS that passes the exact JSON-round-tripped arg across all function forms", async () => {
    const computedKey = Symbol.for("stagehandInitTest");
    const methodContainer = {
      capture(this: void, v: unknown) {
        (globalThis as Record<string, unknown>).__captured = v;
      },
      async captureAsync(this: void, v: unknown) {
        (globalThis as Record<string, unknown>).__captured = v;
      },
      "kebab-capture"(this: void, v: unknown) {
        (globalThis as Record<string, unknown>).__captured = v;
      },
      default(this: void, v: unknown) {
        (globalThis as Record<string, unknown>).__captured = v;
      },
      [computedKey](this: void, v: unknown) {
        (globalThis as Record<string, unknown>).__captured = v;
      },
    };

    const fnVariants: Array<{
      name: string;
      fn: (v: unknown) => unknown;
      isAsync: boolean;
    }> = [
      {
        name: "arrow",
        fn: (v: unknown) => {
          (globalThis as Record<string, unknown>).__captured = v;
        },
        isAsync: false,
      },
      {
        name: "function expression",
        fn: function captureFn(v: unknown) {
          (globalThis as Record<string, unknown>).__captured = v;
        },
        isAsync: false,
      },
      {
        name: "async arrow",
        fn: async (v: unknown) => {
          (globalThis as Record<string, unknown>).__captured = v;
        },
        isAsync: true,
      },
      {
        name: "concise method",
        fn: methodContainer.capture,
        isAsync: false,
      },
      {
        name: "async concise method",
        fn: methodContainer.captureAsync,
        isAsync: true,
      },
      {
        name: "quoted concise method",
        fn: methodContainer["kebab-capture"],
        isAsync: false,
      },
      {
        name: "reserved-word concise method",
        fn: methodContainer.default,
        isAsync: false,
      },
      {
        name: "computed concise method",
        fn: methodContainer[computedKey],
        isAsync: false,
      },
    ];

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...fnVariants), jsonArgArb, async (variant, arg) => {
        const source = await normalizeInitScriptSource(variant.fn, arg);
        const sandbox: Record<string, unknown> = {};
        const result = vm.runInNewContext(source, sandbox);
        if (variant.isAsync) {
          await result;
        }
        expect(structuredClone(sandbox.__captured)).toStrictEqual(arg);
      }),
      { seed: BASE_SEED, numRuns: 150 },
    );
  });

  it("passes string and content-object scripts through verbatim and rejects arg on non-function scripts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 80 }),
        fc.oneof(
          fc.constant(null),
          fc.constant(false),
          fc.constant(0),
          fc.constant(""),
          fc.integer(),
        ),
        fc.stringMatching(/^[a-zA-Z0-9_.]{1,24}$/),
        async (code, nonUndefinedArg, caller) => {
          await expect(normalizeInitScriptSource(code)).resolves.toBe(code);
          await expect(normalizeInitScriptSource({ content: code })).resolves.toBe(code);

          await expect(
            normalizeInitScriptSource(
              code as unknown as InitScriptSource<unknown>,
              nonUndefinedArg,
              caller,
            ),
          ).rejects.toThrow(new RegExp(caller.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          await expect(
            normalizeInitScriptSource(
              { content: code } as unknown as InitScriptSource<unknown>,
              nonUndefinedArg,
              caller,
            ),
          ).rejects.toThrow(TypeError);
        },
      ),
      { seed: BASE_SEED + 1, numRuns: 80 },
    );
  });

  it("rejects non-script values and path objects with TypeError naming the caller", async () => {
    const invalidSourceArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.constant({ path: "./init.js" }),
      fc.constant({ content: 123 }),
      fc.constant({}),
    );

    await fc.assert(
      fc.asyncProperty(
        invalidSourceArb,
        fc.stringMatching(/^[a-zA-Z0-9_.]{1,20}$/),
        async (badSource, caller) => {
          await expect(
            normalizeInitScriptSource(
              badSource as unknown as InitScriptSource<never>,
              undefined,
              caller,
            ),
          ).rejects.toThrow(TypeError);
        },
      ),
      { seed: BASE_SEED + 2, numRuns: 40 },
    );
  });
});
