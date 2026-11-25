import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import {
  ClearCookieOptionsSchema,
  ContextClearCookiesParamsSchema,
  ContextCookiesParamsSchema,
  InputFilePayloadSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { Cookie, StagehandRpcNotification } from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { decodeBase64 } from "../src/base64.js";
import { BrowserContext, type ClearCookieOptions } from "../src/browserContext.js";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { MAX_INPUT_FILE_BYTES, normalizeFileInput, type FilePayload } from "../src/fileUpload.js";
import {
  normalizeEvaluationExpression,
  normalizeFunctionWaitExpression,
  normalizeInitScriptSource,
} from "../src/pageScripts.js";
import { browserPlatform, type BrowserApiPlatform } from "../src/platform.js";

const RFC4648_CANONICAL = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
    fc.string({ maxLength: 40 }),
    fc.array(tie("value"), { maxLength: 5 }),
    fc.dictionary(
      fc.oneof(fc.string({ maxLength: 16 }), fc.constant("__proto__"), fc.constant("constructor")),
      tie("value"),
      { maxKeys: 5 },
    ),
  ),
})).value;

const nonEmptyFileNameArb = fc
  .string({ minLength: 1, maxLength: 48 })
  .filter((name) => name.length > 0);

const slicedUint8ArrayArb = fc
  .tuple(
    fc.uint8Array({ minLength: 0, maxLength: 256 }),
    fc.integer({ min: 0, max: 64 }),
    fc.integer({ min: 0, max: 64 }),
  )
  .map(([payload, prefixLen, suffixLen]) => {
    const backing = new Uint8Array(prefixLen + payload.length + suffixLen);
    backing.fill(0xa5);
    backing.set(payload, prefixLen);
    return backing.subarray(prefixLen, prefixLen + payload.length);
  });

const unicodeWithSurrogatesArb = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0x00, max: 0x7f }).map((cp) => String.fromCharCode(cp)),
      fc.integer({ min: 0x80, max: 0x7ff }).map((cp) => String.fromCharCode(cp)),
      fc.integer({ min: 0x800, max: 0xd7ff }).map((cp) => String.fromCharCode(cp)),
      fc.integer({ min: 0xe000, max: 0xffff }).map((cp) => String.fromCharCode(cp)),
      fc.integer({ min: 0x10000, max: 0x10ffff }).map((cp) => String.fromCodePoint(cp)),
      fc.integer({ min: 0xd800, max: 0xdfff }).map((cp) => String.fromCharCode(cp)),
    ),
    { maxLength: 48 },
  )
  .map((parts) => parts.join(""));

function createRecordingClient(
  platform: BrowserApiPlatform = browserPlatform,
  cookiesResponse: Cookie[] = [],
): {
  client: StagehandCommandClient;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client: StagehandCommandClient = {
    platform,
    async send<Method extends RPCMethod>(
      method: Method,
      params: z.input<Method["params"]>,
    ): Promise<z.output<Method["result"]>> {
      calls.push({ method: method.name, params });
      if (method.name === StagehandMethods.contextCookies.name) {
        return cookiesResponse as unknown as z.output<Method["result"]>;
      }
      if (method.name === StagehandMethods.contextGetDomainPolicy.name) {
        return null as unknown as z.output<Method["result"]>;
      }
      if (method.name === StagehandMethods.contextPages.name) {
        return [] as unknown as z.output<Method["result"]>;
      }
      if (method.name === StagehandMethods.contextActivePage.name) {
        return null as unknown as z.output<Method["result"]>;
      }
      if (method.name === StagehandMethods.contextNewPage.name) {
        return { pageId: "p-new" } as unknown as z.output<Method["result"]>;
      }
      return { ok: true } as unknown as z.output<Method["result"]>;
    },
    onNotification(_listener: (notification: StagehandRpcNotification) => void): () => void {
      return () => {};
    },
  };
  return { client, calls };
}

function createProtoPreservingObject(key: string, value: unknown): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return obj;
}

describe("browser-api codecs property verification", () => {
  describe("base64 & platform encoding codecs", () => {
    it("round-trips arbitrary byte views including non-zero byteOffset and matches Buffer parity", () => {
      fc.assert(
        fc.property(
          slicedUint8ArrayArb,
          fc.string({ minLength: 1, maxLength: 20 }),
          (view, src) => {
            const encoded = browserPlatform.encodeBase64(view);
            const expected = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString(
              "base64",
            );
            expect(encoded).toBe(expected);
            expect(encoded.length % 4).toBe(0);
            expect(RFC4648_CANONICAL.test(encoded)).toBe(true);

            const decoded = decodeBase64(encoded, src);
            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(decoded).toStrictEqual(new Uint8Array(view));
          },
        ),
        { seed: 4201, numRuns: 200 },
      );
    });

    it("handles empty, non-multiple-of-3, and large chunk boundary lengths losslessly", () => {
      const boundaryLengths = [0, 1, 2, 3, 4, 5, 6, 4095, 4096, 4097, 65_535, 65_536, 65_537];
      for (const length of boundaryLengths) {
        const backing = new Uint8Array(length + 7);
        for (let i = 0; i < backing.length; i += 1) {
          backing[i] = (i * 131 + 17) & 0xff;
        }
        const slice = backing.subarray(3, 3 + length);
        const encoded = browserPlatform.encodeBase64(slice);
        expect(encoded).toBe(Buffer.from(slice).toString("base64"));
        expect(decodeBase64(encoded, "boundary")).toStrictEqual(new Uint8Array(slice));
      }
    });

    it("rejects malformed and non-canonical base64 strings while preserving source name", () => {
      const alphabetChars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
      const nonCanonicalTwoPadChars = alphabetChars.filter((_, idx) => (idx & 0x0f) !== 0);
      const nonCanonicalOnePadChars = alphabetChars.filter((_, idx) => (idx & 0x03) !== 0);

      const nonCanonicalTwoPadArb = fc
        .tuple(fc.constantFrom(...alphabetChars), fc.constantFrom(...nonCanonicalTwoPadChars))
        .map(([a, b]) => `${a}${b}==`);

      const nonCanonicalOnePadArb = fc
        .tuple(
          fc.constantFrom(...alphabetChars),
          fc.constantFrom(...alphabetChars),
          fc.constantFrom(...nonCanonicalOnePadChars),
        )
        .map(([a, b, c]) => `${a}${b}${c}=`);

      const malformedArb = fc.oneof(
        nonCanonicalTwoPadArb,
        nonCanonicalOnePadArb,
        fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.length % 4 !== 0),
        fc.constantFrom("AA==", "AAAA", "Zg==").map((valid) => ` ${valid}`),
        fc.constantFrom("AA==", "AAAA", "Zg==").map((valid) => `${valid}\n`),
        fc.constantFrom("-_==", "A=AA", "====", "A===", "AB=C", "Zg=", "Zg===="),
      );

      fc.assert(
        fc.property(malformedArb, fc.string({ minLength: 1, maxLength: 20 }), (bad, source) => {
          expect(() => decodeBase64(bad, source)).toThrow(`${source} returned invalid base64`);
        }),
        { seed: 4202, numRuns: 200 },
      );
    });

    it("matches Buffer.byteLength exactly in browserPlatform.utf8ByteLengthExceeds across Unicode and negative/zero limits", () => {
      fc.assert(
        fc.property(
          unicodeWithSurrogatesArb,
          fc.oneof(
            fc.integer({ min: -5, max: 160 }),
            fc.constant(Number.NaN),
            fc.constant(Number.POSITIVE_INFINITY),
          ),
          (str, limit) => {
            const actualBytes = Buffer.byteLength(str, "utf8");
            expect(browserPlatform.utf8ByteLengthExceeds(str, limit)).toBe(actualBytes > limit);
          },
        ),
        { seed: 4203, numRuns: 250 },
      );
    });
  });

  describe("fileUpload normalization", () => {
    it("normalizes arbitrary ordered payloads into protocol-valid InputFilePayload arrays", async () => {
      const payloadArb: fc.Arbitrary<FilePayload> = fc.record({
        name: nonEmptyFileNameArb,
        mimeType: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
        buffer: fc.oneof(
          unicodeWithSurrogatesArb,
          slicedUint8ArrayArb,
          slicedUint8ArrayArb.map((view) => view.slice().buffer),
        ),
        lastModified: fc.option(
          fc.oneof(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.constant(-0)),
          { nil: undefined },
        ),
      });

      await fc.assert(
        fc.asyncProperty(fc.array(payloadArb, { maxLength: 6 }), async (payloads) => {
          const normalized = await normalizeFileInput(payloads, browserPlatform);
          expect(normalized).toHaveLength(payloads.length);

          for (let i = 0; i < payloads.length; i += 1) {
            const input = payloads[i]!;
            const output = normalized[i]!;
            expect(InputFilePayloadSchema.parse(output)).toStrictEqual(output);
            expect(output.name).toBe(input.name);

            if (input.mimeType) {
              expect(output.mimeType).toBe(input.mimeType);
            } else {
              expect("mimeType" in output).toBe(false);
            }

            if (input.lastModified === undefined) {
              expect("lastModified" in output).toBe(false);
            } else {
              expect(Object.is(output.lastModified, -0)).toBe(false);
              expect(output.lastModified).toBe(input.lastModified === 0 ? 0 : input.lastModified);
            }

            const expectedBytes =
              typeof input.buffer === "string"
                ? new TextEncoder().encode(input.buffer)
                : input.buffer instanceof Uint8Array
                  ? new Uint8Array(input.buffer)
                  : new Uint8Array(input.buffer);
            expect(decodeBase64(output.data, "fileUpload")).toStrictEqual(expectedBytes);
          }
        }),
        { seed: 4204, numRuns: 150 },
      );
    });

    it("enforces exact 50 MiB boundary without invoking encoder when oversized", async () => {
      const encodeSpy = vi.fn((bytes: Uint8Array) => browserPlatform.encodeBase64(bytes));
      const customPlatform: BrowserApiPlatform = {
        ...browserPlatform,
        encodeBase64: encodeSpy,
      };

      const exactBytes = new Uint8Array(MAX_INPUT_FILE_BYTES);
      const exactResult = await normalizeFileInput(
        { name: "exact.bin", buffer: exactBytes },
        {
          ...customPlatform,
          encodeBase64: () => "AAAA",
        },
      );
      expect(exactResult).toStrictEqual([{ name: "exact.bin", data: "AAAA" }]);

      const overBytes = new Uint8Array(MAX_INPUT_FILE_BYTES + 1);
      await expect(
        normalizeFileInput({ name: "over.bin", buffer: overBytes }, customPlatform),
      ).rejects.toThrow(RangeError);
      expect(encodeSpy).not.toHaveBeenCalled();

      const overBuffer = new ArrayBuffer(MAX_INPUT_FILE_BYTES + 1);
      await expect(
        normalizeFileInput({ name: "over-ab.bin", buffer: overBuffer }, customPlatform),
      ).rejects.toThrow(RangeError);
      expect(encodeSpy).not.toHaveBeenCalled();

      const stringOverPlatform: BrowserApiPlatform = {
        ...customPlatform,
        utf8ByteLengthExceeds: (_value, limit) => limit === MAX_INPUT_FILE_BYTES,
      };
      await expect(
        normalizeFileInput({ name: "over-str.txt", buffer: "short" }, stringOverPlatform),
      ).rejects.toThrow(RangeError);
      expect(encodeSpy).not.toHaveBeenCalled();
    });

    it("rejects invalid payloads, names, mimeTypes, buffers, and out-of-range lastModified values", async () => {
      const invalidLastModifiedArb = fc.oneof(
        fc.integer({ min: -1_000_000, max: -1 }),
        fc.double({ min: 0.01, max: 1000, noNaN: true }).filter((n) => !Number.isInteger(n)),
        fc.constantFrom(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
          1e25,
        ),
      );

      await fc.assert(
        fc.asyncProperty(invalidLastModifiedArb, async (lastModified) => {
          await expect(
            normalizeFileInput({ name: "bad-ts.bin", buffer: "ok", lastModified }),
          ).rejects.toThrow(RangeError);
        }),
        { seed: 4205, numRuns: 60 },
      );

      const invalidEntries: unknown[] = [
        null,
        undefined,
        42,
        true,
        { name: "", buffer: "ok" },
        { name: 123, buffer: "ok" },
        { name: null, buffer: "ok" },
        { name: "bad-mime.bin", mimeType: 42, buffer: "ok" },
        { name: "bad-buf-int8.bin", buffer: new Int8Array([1, 2]) },
        { name: "bad-buf-u16.bin", buffer: new Uint16Array([1, 2]) },
        { name: "bad-buf-clamped.bin", buffer: new Uint8ClampedArray([1, 2]) },
        { name: "bad-buf-dv.bin", buffer: new DataView(new ArrayBuffer(4)) },
        { name: "bad-buf-obj.bin", buffer: { length: 1 } },
        { name: "bad-buf-null.bin", buffer: null },
      ];

      for (const entry of invalidEntries) {
        await expect(normalizeFileInput(entry as FilePayload)).rejects.toThrow(TypeError);
      }
    });

    it("preserves order when mixing file paths and payloads with a custom platform", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              nonEmptyFileNameArb,
              fc.record({ name: nonEmptyFileNameArb, buffer: fc.string({ maxLength: 16 }) }),
            ),
            { minLength: 1, maxLength: 6 },
          ),
          async (entries) => {
            const readOrder: string[] = [];
            const platform: BrowserApiPlatform = {
              ...browserPlatform,
              async readInputFile(filePath) {
                readOrder.push(filePath);
                return {
                  name: filePath,
                  data: browserPlatform.encodeBase64(new TextEncoder().encode(filePath)),
                };
              },
            };

            const result = await normalizeFileInput(entries as FilePayload[], platform);
            expect(result.map((item) => item.name)).toStrictEqual(
              entries.map((entry) => (typeof entry === "string" ? entry : entry.name)),
            );
            expect(readOrder).toStrictEqual(entries.filter((e) => typeof e === "string"));
          },
        ),
        { seed: 4206, numRuns: 80 },
      );
    });
  });

  describe("pageScripts normalization & vm execution", () => {
    const syncFunctions: Array<{ label: string; fn: (arg: unknown) => unknown }> = [
      { label: "arrow-parens", fn: (arg) => ({ received: arg }) },
      { label: "arrow-bare", fn: (arg) => arg },
      {
        label: "arrow-trailing-comment",
        fn: runInNewContext("arg => ({ received: arg }) // trailing comment"),
      },
      {
        label: "arrow-named-async-param",
        fn: runInNewContext("async => ({ received: async })"),
      },
      {
        label: "function-expr",
        fn: function (arg) {
          return { received: arg };
        },
      },
      {
        label: "named-function-expr",
        fn: function echo(arg) {
          return { received: arg };
        },
      },
      {
        label: "concise-method",
        fn: {
          echo(this: void, arg: unknown) {
            return { received: arg };
          },
        }.echo,
      },
      {
        label: "concise-quoted-method",
        fn: {
          "a(b) 'quoted' method"(this: void, arg: unknown) {
            return { received: arg };
          },
        }["a(b) 'quoted' method"],
      },
      {
        label: "concise-single-quoted-method",
        fn: runInNewContext("({ 'x\"(y)'(arg) { return { received: arg }; } })['x\"(y)']"),
      },
      {
        label: "concise-computed-method",
        fn: runInNewContext(
          "(() => { const k = 'dyn'; const helper = (a, b) => k; return ({ [helper(1, [2])](arg) { return { received: arg }; } })[k]; })()",
        ),
      },
      {
        label: "concise-numeric-method",
        fn: {
          0(this: void, arg: unknown) {
            return { received: arg };
          },
        }[0],
      },
      {
        label: "concise-method-named-async",
        fn: {
          async(this: void, arg: unknown) {
            return { received: arg };
          },
        }.async,
      },
      {
        label: "concise-method-named-async-with-space",
        fn: runInNewContext("({ async (arg) { return { received: arg }; } }).async"),
      },
      {
        label: "concise-method-named-class",
        fn: {
          class(this: void, arg: unknown) {
            return { received: arg };
          },
        }.class,
      },
      {
        label: "concise-method-named-function",
        fn: {
          function(this: void, arg: unknown) {
            return { received: arg };
          },
        }.function,
      },
      {
        label: "concise-getter-descriptor",
        fn: runInNewContext(
          "Object.getOwnPropertyDescriptor({ get prop() { return { received: 'getter' }; } }, 'prop').get",
        ),
      },
      {
        label: "arrow-regex-quote-and-trailing-comment",
        fn: runInNewContext("arg => ({ received: arg, re: /'/.test(\"'\") }) // trailing comment"),
      },
      {
        label: "arrow-template-with-slashes",
        fn: runInNewContext("arg => ({ received: arg, url: `https://example.test/${1}` })"),
      },
      {
        label: "native-code-string-in-body",
        fn: (arg) => ({ received: arg, marker: "[native code]" }),
      },
    ];

    const asyncFunctions: Array<{ label: string; fn: (arg: unknown) => Promise<unknown> }> = [
      { label: "async-arrow-parens", fn: async (arg) => ({ received: arg }) },
      {
        label: "async-arrow-bare",
        fn: runInNewContext("async arg => ({ received: arg }) // end comment"),
      },
      {
        label: "async-function-expr",
        fn: async function (arg) {
          return { received: arg };
        },
      },
      {
        label: "concise-async-method",
        fn: {
          async echo(this: void, arg: unknown) {
            return { received: arg };
          },
        }.echo,
      },
      {
        label: "concise-async-quoted-method",
        fn: {
          "async (quoted)"(this: void, arg: unknown) {
            return Promise.resolve({ received: arg });
          },
        }["async (quoted)"],
      },
      {
        label: "concise-async-computed-method",
        fn: runInNewContext(
          "(() => { const k = 'a'; return ({ async [k](arg) { return { received: arg }; } })[k]; })()",
        ),
      },
      {
        label: "concise-async-named-async",
        fn: {
          async async(this: void, arg: unknown) {
            return { received: arg };
          },
        }.async,
      },
      {
        label: "async-arrow-regex-default-param",
        fn: runInNewContext(
          "async (arg = /\\)/) => ({ received: arg instanceof RegExp ? arg.source : arg })",
        ),
      },
      {
        label: "async-arrow-charclass-regex-and-template-default-param",
        fn: runInNewContext(
          "async (arg = /[)]/, extra = `${/\\}/}`) => ({ received: arg instanceof RegExp ? arg.source : arg, extra })",
        ),
      },
      {
        label: "async-arrow-chained-division-default-param",
        fn: runInNewContext("async (arg = 1 / 2 / 3) => ({ received: arg })"),
      },
      {
        label: "async-arrow-division-then-regex-default-param",
        fn: runInNewContext("async (arg = 1 / /\\)/.source.length) => ({ received: arg })"),
      },
      {
        label: "async-arrow-property-keyword-division-default-param",
        fn: runInNewContext("async (arg = ({ return: 12 }).return / 2 / 3) => ({ received: arg })"),
      },
      {
        label: "async-arrow-if-header-regex-default-param",
        fn: runInNewContext(
          'async (arg = (() => { let ok = false; if (true) ok = /\\)/.test(")"); return ok; })()) => ({ received: arg })',
        ),
      },
    ];

    it("produces vm-executable scripts for arbitrary sync/async function shapes and JSON args", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...syncFunctions),
          fc.oneof(fc.constant(undefined), jsonValueArb),
          async ({ fn }, arg) => {
            const evalCode = normalizeEvaluationExpression(fn, arg);
            const evalOut = runInNewContext(evalCode);
            const expected = fn(arg);
            expect(evalOut).toEqual(expected);

            const waitCode = normalizeFunctionWaitExpression(fn, arg);
            const waitFn = runInNewContext(waitCode) as () => unknown;
            expect(typeof waitFn).toBe("function");
            expect(waitFn()).toEqual(expected);

            const initCode = await normalizeInitScriptSource(fn, arg);
            const initOut = runInNewContext(initCode);
            expect(initOut).toEqual(expected);
          },
        ),
        { seed: 4207, numRuns: 160 },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...asyncFunctions),
          fc.oneof(fc.constant(undefined), jsonValueArb),
          async ({ fn }, arg) => {
            const evalCode = normalizeEvaluationExpression(fn, arg);
            const evalOut = await runInNewContext(evalCode);
            const expected = await fn(arg);
            expect(evalOut).toEqual(expected);

            const waitCode = normalizeFunctionWaitExpression(fn, arg);
            const waitFn = runInNewContext(waitCode) as () => Promise<unknown>;
            expect(await waitFn()).toEqual(expected);

            const initCode = await normalizeInitScriptSource(fn, arg);
            const initOut = await runInNewContext(initCode);
            expect(initOut).toEqual(expected);
          },
        ),
        { seed: 4208, numRuns: 100 },
      );
    });

    it("preserves own __proto__ keys across evaluate, waitForFunction, and addInitScript", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 16 }),
          fc.integer({ min: -100, max: 100 }),
          async (innerKey, innerVal) => {
            const arg = createProtoPreservingObject(
              "__proto__",
              createProtoPreservingObject(innerKey, innerVal),
            );
            const probe = (input: Record<string, unknown>) => ({
              hasOwnProto: Object.prototype.hasOwnProperty.call(input, "__proto__"),
              protoPayload: Object.getOwnPropertyDescriptor(input, "__proto__")?.value,
            });

            const evalResult = runInNewContext(normalizeEvaluationExpression(probe, arg));
            expect(evalResult.hasOwnProto).toBe(true);
            expect(evalResult.protoPayload).toEqual({ [innerKey]: innerVal });

            const waitFn = runInNewContext(normalizeFunctionWaitExpression(probe, arg)) as () => {
              hasOwnProto: boolean;
              protoPayload: unknown;
            };
            const waitResult = waitFn();
            expect(waitResult.hasOwnProto).toBe(true);
            expect(waitResult.protoPayload).toEqual({ [innerKey]: innerVal });

            const initResult = runInNewContext(await normalizeInitScriptSource(probe, arg));
            expect(initResult.hasOwnProto).toBe(true);
            expect(initResult.protoPayload).toEqual({ [innerKey]: innerVal });
          },
        ),
        { seed: 4209, numRuns: 60 },
      );
    });

    it("handles string expressions with trailing comments in normalizeFunctionWaitExpression", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            "(x) => ({ x }) // trailing comment",
            "(x) => x\n// second line comment",
            "42 // constant value",
          ),
          jsonValueArb,
          (expr, arg) => {
            const code = normalizeFunctionWaitExpression(expr, arg);
            const out = runInNewContext(code);
            if (expr.startsWith("42")) {
              expect(out).toBe(42);
            } else {
              expect(typeof out).toBe("function");
              const result = (out as () => unknown)();
              if (expr.includes("{ x }")) {
                expect(result).toEqual({ x: arg });
              } else {
                expect(result).toEqual(arg);
              }
            }
          },
        ),
        { seed: 4210, numRuns: 80 },
      );
    });

    it("sanitizes all ECMAScript line terminators in sourceURL for { path } init scripts", async () => {
      const adversarialPathArb = fc
        .tuple(
          fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
          fc.constantFrom("\n", "\r", "\u2028", "\u2029", "\r\n"),
          fc.constantFrom("throw new Error('injected')", "globalThis.pwned = true", "file.js"),
        )
        .map(([prefix, sep, suffix]) => `${prefix}${sep}${suffix}`);

      await fc.assert(
        fc.asyncProperty(adversarialPathArb, async (filePath) => {
          const platform: BrowserApiPlatform = {
            ...browserPlatform,
            async readTextFile() {
              return "globalThis.ok = 123;";
            },
          };

          const source = await normalizeInitScriptSource(
            { path: filePath },
            undefined,
            "page.addInitScript",
            platform,
          );
          const sandbox: Record<string, unknown> = {};
          runInNewContext(source, sandbox);
          expect(sandbox.ok).toBe(123);
          expect(sandbox.pwned).toBeUndefined();
        }),
        { seed: 4211, numRuns: 60 },
      );
    });

    it("rejects native/bound/class functions, circular/non-JSON args, and malformed initScript shapes cleanly", async () => {
      const invalidFunctions: Array<(...args: never[]) => unknown> = [
        Math.max,
        Number,
        ((x: unknown) => x).bind(null),
        class NotCallable {},
      ];
      for (const badFn of invalidFunctions) {
        expect(() => normalizeEvaluationExpression(badFn as (arg: unknown) => unknown, 1)).toThrow(
          TypeError,
        );
        expect(() =>
          normalizeFunctionWaitExpression(badFn as (arg: unknown) => unknown, 1),
        ).toThrow(TypeError);
        await expect(
          normalizeInitScriptSource(badFn as (arg: unknown) => unknown, 1),
        ).rejects.toThrow(TypeError);
      }

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const circularArr: unknown[] = [];
      circularArr.push(circularArr);

      const nonJsonArgs: unknown[] = [
        1n,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Symbol("s"),
        () => {},
        new Date(),
        /abc/,
        new Map(),
        new Set(),
        { a: undefined },
        [undefined],
        circular,
        circularArr,
      ];
      for (const badArg of nonJsonArgs) {
        expect(() => normalizeEvaluationExpression((x) => x, badArg, "custom.eval")).toThrow(
          "custom.eval: 'arg' must be JSON-serializable.",
        );
        expect(() => normalizeFunctionWaitExpression((x) => x, badArg, "custom.wait")).toThrow(
          "custom.wait: 'arg' must be JSON-serializable.",
        );
        await expect(normalizeInitScriptSource((x) => x, badArg, "custom.init")).rejects.toThrow(
          "custom.init: 'arg' must be JSON-serializable.",
        );
      }

      const malformedInitSources: unknown[] = [
        null,
        undefined,
        123,
        true,
        [],
        {},
        { path: "" },
        { path: "   \t\n  " },
        { path: "a.js", content: "1" },
        { path: "", content: "1" },
        { path: "   ", content: "1" },
        { path: 123, content: "1" },
        { path: "a.js", content: 123 },
        { content: 123 },
        { path: 123 },
      ];
      for (const badSource of malformedInitSources) {
        await expect(
          normalizeInitScriptSource(badSource as string, undefined, "ctx.addInitScript"),
        ).rejects.toThrow(TypeError);
      }
    });
  });

  describe("browserContext cookie filter & option normalization", () => {
    const validFlagsArb = fc
      .subarray(["d", "g", "i", "m", "s", "u", "y"] as const)
      .map((flags) => flags.join(""));

    const safeRegexArb = fc
      .tuple(
        fc.constantFrom(
          "^session-",
          "example\\.com$",
          "^[a-z0-9_]+$",
          "/api/v[0-9]+/",
          ".*",
          "",
          "foo|bar",
        ),
        validFlagsArb,
        fc.integer({ min: 0, max: 20 }),
      )
      .map(([pattern, flags, lastIndex]) => {
        const regex = new RegExp(pattern, flags);
        regex.lastIndex = lastIndex;
        return { regex, initialLastIndex: lastIndex };
      });

    it("serializes arbitrary string and RegExp cookie filters (including flagless, cross-realm, and stateful g/y) without mutating lastIndex", async () => {
      const filterArb = fc.option(
        fc.oneof(
          fc.string({ maxLength: 32 }).map((s) => ({ kind: "string" as const, value: s })),
          safeRegexArb.map((r) => ({ kind: "regex" as const, ...r })),
          safeRegexArb.map((r) => {
            const crossRealm = runInNewContext(
              `new RegExp(${JSON.stringify(r.regex.source)}, ${JSON.stringify(r.regex.flags)})`,
            ) as RegExp;
            crossRealm.lastIndex = r.initialLastIndex;
            return {
              kind: "regex" as const,
              regex: crossRealm,
              initialLastIndex: r.initialLastIndex,
            };
          }),
        ),
        { nil: undefined },
      );

      await fc.assert(
        fc.asyncProperty(filterArb, filterArb, filterArb, async (name, domain, pathFilter) => {
          const { client, calls } = createRecordingClient();
          const context = new BrowserContext(client);

          const options: ClearCookieOptions = {
            ...(name ? { name: name.kind === "string" ? name.value : name.regex } : {}),
            ...(domain ? { domain: domain.kind === "string" ? domain.value : domain.regex } : {}),
            ...(pathFilter
              ? { path: pathFilter.kind === "string" ? pathFilter.value : pathFilter.regex }
              : {}),
          };

          await context.clearCookies(options);
          expect(calls).toHaveLength(1);
          const sentParams = calls[0]!.params;
          expect(ContextClearCookiesParamsSchema.parse(sentParams)).toStrictEqual(sentParams);
          const serializedOptions = (sentParams as { options: unknown }).options;
          expect(ClearCookieOptionsSchema.parse(serializedOptions)).toStrictEqual(
            serializedOptions,
          );

          for (const [key, spec] of [
            ["name", name],
            ["domain", domain],
            ["path", pathFilter],
          ] as const) {
            const serialized = (serializedOptions as Record<string, unknown>)[key];
            if (!spec) {
              expect(key in (serializedOptions as Record<string, unknown>)).toBe(false);
              continue;
            }
            if (spec.kind === "string") {
              expect(serialized).toBe(spec.value);
            } else {
              expect(serialized).toStrictEqual({
                source: spec.regex.source,
                flags: spec.regex.flags,
              });
              expect(spec.regex.lastIndex).toBe(spec.initialLastIndex);
              const hydrated = new RegExp(
                (serialized as { source: string; flags: string }).source,
                (serialized as { source: string; flags: string }).flags,
              );
              expect(hydrated.source).toBe(spec.regex.source);
              expect(hydrated.flags).toBe(spec.regex.flags);
            }
          }
        }),
        { seed: 4212, numRuns: 150 },
      );
    });

    it("rejects malformed clearCookies options, unknown keys, and non-string/non-RegExp filters before sending RPC", async () => {
      const invalidInputs: unknown[] = [
        null,
        42,
        "session",
        [],
        /session/,
        { domainn: "example.com" },
        { domainn: undefined },
        { name: "session", extra: "unexpected" },
        { name: null },
        { name: 123 },
        { domain: {} },
        { path: ["a"] },
        { name: { [Symbol.toStringTag]: "RegExp", source: "session", flags: "i" } },
        { domain: Object.create(RegExp.prototype) },
        { path: RegExp.prototype },
        { name: runInNewContext("RegExp.prototype") },
        { domain: new Proxy(/example\.com/i, {}) },
      ];

      for (const bad of invalidInputs) {
        const { client, calls } = createRecordingClient();
        const context = new BrowserContext(client);
        await expect(context.clearCookies(bad as ClearCookieOptions)).rejects.toThrow(TypeError);
        expect(calls).toHaveLength(0);
      }

      class CustomRegExp extends RegExp {}
      const crossRealmRegex = runInNewContext("/session/gi") as RegExp;
      crossRealmRegex.lastIndex = 4;
      const subclassRegex = new CustomRegExp("example\\.test", "i");
      const { client, calls } = createRecordingClient();
      const context = new BrowserContext(client);
      await context.clearCookies({ name: crossRealmRegex, domain: subclassRegex });
      expect(crossRealmRegex.lastIndex).toBe(4);
      expect(calls).toStrictEqual([
        {
          method: StagehandMethods.contextClearCookies.name,
          params: {
            options: {
              name: { source: "session", flags: "gi" },
              domain: { source: "example\\.test", flags: "i" },
            },
          },
        },
      ]);
    });

    it("forwards addCookies, setDomainPolicy, cookies, and clipboard memoization accurately", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 1, maxLength: 16 }),
              value: fc.string({ maxLength: 32 }),
              url: fc.constant("https://example.test/"),
            }),
            { maxLength: 4 },
          ),
          fc.option(
            fc.record({
              allowedDomains: fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
                maxLength: 3,
              }),
              blockedDomains: fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
                maxLength: 3,
              }),
            }),
            { nil: null },
          ),
          fc.oneof(
            fc.constant(undefined),
            fc.constant("https://example.test/"),
            fc.array(fc.constantFrom("https://example.test/", "https://api.example.test/v1"), {
              maxLength: 3,
            }),
          ),
          async (cookies, policy, cookieUrls) => {
            const mockReturnedCookies: Cookie[] = cookies.map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
              domain: "example.test",
              path: "/",
              expires: -1,
              httpOnly: false,
              secure: true,
              sameSite: "Lax",
            }));
            const { client, calls } = createRecordingClient(browserPlatform, mockReturnedCookies);
            const context = new BrowserContext(client);

            expect(context.clipboard).toBe(context.clipboard);
            await context.addCookies(cookies);
            const fetchedCookies = await context.cookies(cookieUrls);
            await context.setDomainPolicy(policy);
            await context.getDomainPolicy();
            await expect(context.close()).rejects.toThrow(
              "Browser context is not attached to a browser",
            );

            const expectedCookiesParams = cookieUrls === undefined ? {} : { urls: cookieUrls };
            expect(ContextCookiesParamsSchema.parse(expectedCookiesParams)).toStrictEqual(
              expectedCookiesParams,
            );
            expect(fetchedCookies).toStrictEqual(mockReturnedCookies);
            expect(calls).toStrictEqual([
              { method: StagehandMethods.contextAddCookies.name, params: { cookies } },
              { method: StagehandMethods.contextCookies.name, params: expectedCookiesParams },
              { method: StagehandMethods.contextSetDomainPolicy.name, params: { policy } },
              { method: StagehandMethods.contextGetDomainPolicy.name, params: {} },
            ]);
          },
        ),
        { seed: 4213, numRuns: 80 },
      );
    });
  });
});
