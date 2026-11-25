import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFacadeLogger, redactToolLog } from "../src/facade/logging.js";
import {
  buildAllowlistedEnv,
  clip,
  harnessEventLogLevel,
  isLifecycleBoundaryEventType,
  isStreamDeltaEventType,
  isTokenCount,
  positiveInteger,
  safeJson,
  sanitizeErrorMessage,
  stringifyError,
  toFiniteNumber,
} from "../src/harness/index.js";

const DEFAULT_FC_SEED = 20261125;

function fcParams(numRuns: number): { numRuns: number; seed?: number } {
  return process.env.FC_UNSEEDED === "1" ? { numRuns } : { numRuns, seed: DEFAULT_FC_SEED };
}

function isWellFormedUtf16(value: string): boolean {
  return (value as string & { isWellFormed(): boolean }).isWellFormed();
}

const SECRET_SAFE_TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

const secretCanaryArb = fc
  .array(fc.constantFrom(...SECRET_SAFE_TOKEN_CHARS.split("")), { minLength: 10, maxLength: 24 })
  .map((chars) => `CANARY_${chars.join("")}`);

const querySecretValueArb = fc
  .array(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~-!()*+^${}|[]".split(""),
    ),
    { minLength: 8, maxLength: 20 },
  )
  .map((chars) => `QSEC${chars.join("")}`);

const queryParamNameArb = fc.constantFrom("signingKey", "apiKey", "api_key", "token", "key");

const jsonLeafArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.string({ maxLength: 40 }),
);

const unicodeWithAstralArb = fc.string({ unit: "grapheme", maxLength: 64 });

describe("harness redaction & logging non-interference (fast-check)", () => {
  it("sanitizeErrorMessage never leaks query-param secrets including metacharacters, $&, JSON-escapes, and URL-encoded forms", () => {
    fc.assert(
      fc.property(
        queryParamNameArb,
        querySecretValueArb,
        fc.constantFrom("?", "&"),
        fc.string({ maxLength: 20 }),
        (param, secret, sep, suffix) => {
          const plain = `https://example.test/ws${sep}${param}=${secret}&next=ok ${suffix}`;
          const redactedPlain = sanitizeErrorMessage(plain);
          expect(redactedPlain).not.toContain(secret);
          expect(sanitizeErrorMessage(redactedPlain)).toBe(redactedPlain);

          const jsonWrapped = JSON.stringify({
            url: `https://example.test/ws${sep}${param}=${secret}`,
          });
          const redactedJson = sanitizeErrorMessage(jsonWrapped);
          expect(redactedJson).not.toContain(secret);
          expect(() => JSON.parse(redactedJson)).not.toThrow();

          const urlEncoded = `redirect=https%3A%2F%2Fexample.test%3F${param}%3D${encodeURIComponent(secret)}%26ok%3D1`;
          const redactedEncoded = sanitizeErrorMessage(urlEncoded);
          expect(redactedEncoded).not.toContain(encodeURIComponent(secret));
          expect(redactedEncoded).not.toContain(secret);

          const withBackslash = `https://example.test/ws${sep}${param}=prefix\\${secret}&next=ok`;
          const redactedBackslash = sanitizeErrorMessage(withBackslash);
          expect(redactedBackslash).not.toContain(secret);
          expect(redactedBackslash).toBe(
            `https://example.test/ws${sep}${param}=[redacted]&next=ok`,
          );

          const escapedJson = `{\\"url\\":\\"https://example.test/ws${sep}${param}=${secret}\\"}`;
          const redactedEscapedJson = sanitizeErrorMessage(escapedJson);
          expect(redactedEscapedJson).not.toContain(secret);
          expect(redactedEscapedJson).toBe(
            `{\\"url\\":\\"https://example.test/ws${sep}${param}=[redacted]\\"}`,
          );

          const trailingBackslashJson = JSON.stringify({
            url: `https://example.test/ws${sep}${param}=${secret}\\`,
          });
          const redactedTrailing = sanitizeErrorMessage(trailingBackslashJson);
          expect(redactedTrailing).not.toContain(secret);
          expect(() => JSON.parse(redactedTrailing)).not.toThrow();

          const encodedWithSpacesAndQuotes = `redirect=https%3A%2F%2Fexample.test%3F${param}%3Dpart1%20%22${secret}%27%26ok%3D1`;
          const redactedEncodedSpecial = sanitizeErrorMessage(encodedWithSpacesAndQuotes);
          expect(redactedEncodedSpecial).not.toContain(secret);
          expect(redactedEncodedSpecial).toBe(
            `redirect=https%3A%2F%2Fexample.test%3F${param}%3D[redacted]%26ok%3D1`,
          );
        },
      ),
      fcParams(200),
    );
  });

  it("sanitizeErrorMessage redacts sk-, bb_live_/bb_test_ (including -/_ prefixes), AIza, and Bearer tokens without leaking suffixes or double-redacting", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_-]{6}$/),
        fc.stringMatching(/^[A-Za-z0-9_-]{4}$/),
        secretCanaryArb,
        fc.constantFrom("bb_live_", "bb_test_"),
        (skPrefix, bbPrefix, canary, bbKind) => {
          const skKey = `sk-${skPrefix}${canary}`;
          const bbKey = `${bbKind}${bbPrefix}${canary}`;
          const googleKey = `AIza${"0".repeat(16)}${canary}`;
          const bearerToken = `tok%2F${canary}`;

          for (const sample of [
            `err ${skKey} end`,
            `err ${bbKey} end`,
            `err ${googleKey} end`,
            `Authorization: Bearer ${bearerToken} end`,
            `Authorization: Bearer ${skKey}`,
            `Authorization: Bearer ${bbKey}`,
            `Authorization: Bearer ${googleKey}`,
          ]) {
            const out = sanitizeErrorMessage(sample);
            expect(out).not.toContain(canary);
            expect(out).not.toContain("[redacted][redacted]");
            expect(sanitizeErrorMessage(out)).toBe(out);
          }
        },
      ),
      fcParams(200),
    );
  });

  it("sanitizeErrorMessage is idempotent on arbitrary Unicode strings and preserves clean text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 120 }), (input) => {
        const once = sanitizeErrorMessage(input);
        const twice = sanitizeErrorMessage(once);
        expect(twice).toBe(once);
      }),
      fcParams(300),
    );

    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[a-z0-9 .,:/()[\]-]{0,60}$/)
          .filter((s) => !/(?:sk-|bb_|aiza|bearer|key=|token=)/i.test(s)),
        (clean) => {
          expect(sanitizeErrorMessage(clean)).toBe(clean);
        },
      ),
      fcParams(200),
    );
  });

  it("redactToolLog never leaks secrets in values, object keys, Errors, Maps, Sets, null-proto objects, or __proto__/constructor keys", () => {
    fc.assert(
      fc.property(secretCanaryArb, fc.string({ maxLength: 20 }), (canary, benign) => {
        const keySecret = `sk-abcdef${canary}`;
        const urlSecret = `https://example.test?apiKey=${canary}`;
        const quotedSecret = `password="prefix ${canary}"`;
        const unterminatedQuoted = `password="top ${canary}\nnext=ok`;
        const basicAuth = `authorization: Basic ${canary}\nHost: example.test`;
        const cookieHeader = `cookie: sid=${canary}; theme=dark\nHost: example.test`;
        const inlineSigning = `signingKey=${canary}`;

        const nullProto = Object.create(null) as Record<string, unknown>;
        nullProto.token = canary;
        nullProto[keySecret] = "value-under-secret-key";
        Object.defineProperty(nullProto, "constructor", {
          value: `Bearer ${canary}`,
          enumerable: true,
        });
        Object.defineProperty(nullProto, "__proto__", {
          value: { secret: canary, ok: benign },
          enumerable: true,
        });

        const err = new Error(`boom ${urlSecret}`);
        err.stack = `Error: boom ${keySecret}\n    at test (${inlineSigning})`;
        (err as Error & { cause?: unknown }).cause = new TypeError(`inner ${quotedSecret}`);
        (err as Error & { data?: string }).data = `BASE64_${canary}`;

        const map = new Map<unknown, unknown>([
          [keySecret, `Bearer ${canary}`],
          ["data", `MAP_BASE64_${canary}`],
          ["safe", benign],
        ]);
        const set = new Set<unknown>([urlSecret, benign]);

        const payload = {
          nested: [{ authorization: canary, ok: benign }, nullProto],
          [urlSecret]: 1,
          error: err,
          map,
          set,
          quoted: quotedSecret,
          unterminated: unterminatedQuoted,
          basicAuth,
          cookieHeader,
          signing: inlineSigning,
        };

        const redacted = redactToolLog(payload, 100_000);
        const serialized = JSON.stringify(redacted);
        expect(serialized).not.toContain(canary);
        expect(serialized).toContain("boom");
        expect(serialized).toContain("binary omitted");
        expect(serialized).toContain("Host: example.test");
      }),
      fcParams(100),
    );
  });

  it("redactToolLog handles cyclic graphs safely, preserves non-circular DAGs, and survives throwing getters and toJSON", () => {
    fc.assert(
      fc.property(secretCanaryArb, fc.integer(), (canary, num) => {
        const cyclic: Record<string, unknown> = {
          secret: canary,
          msg: `sk-abcdef${canary}`,
          count: num,
        };
        cyclic.self = cyclic;
        const cyclicArr: unknown[] = [cyclic];
        cyclicArr.push(cyclicArr);
        cyclic.arr = cyclicArr;

        const redactedCyclic = redactToolLog(cyclic, 100_000);
        const serializedCyclic = JSON.stringify(redactedCyclic);
        expect(serializedCyclic).not.toContain(canary);
        expect(serializedCyclic).toContain("[Circular]");

        const shared = { label: `ok-${num}` };
        const dag = { left: shared, right: shared };
        const redactedDag = redactToolLog(dag, 100_000) as {
          left: { label: string };
          right: { label: string };
        };
        expect(redactedDag.left).toEqual({ label: `ok-${num}` });
        expect(redactedDag.right).toEqual({ label: `ok-${num}` });

        const hostile = {
          get exploding(): string {
            throw new Error(`getter ${canary}`);
          },
          toJSON() {
            throw new Error(`toJSON ${canary}`);
          },
          safe: num,
        };
        const redactedHostile = redactToolLog(hostile, 100_000);
        expect(JSON.stringify(redactedHostile)).not.toContain(canary);

        const hostileError = new Error("initial");
        Object.defineProperty(hostileError, "name", {
          get() {
            throw new Error(`name ${canary}`);
          },
        });
        Object.defineProperty(hostileError, "message", {
          get() {
            throw new Error(`message ${canary}`);
          },
        });
        Object.defineProperty(hostileError, "stack", {
          get() {
            throw new Error(`stack ${canary}`);
          },
        });
        Object.defineProperty(hostileError, "cause", {
          get() {
            throw new Error(`cause ${canary}`);
          },
        });
        const redactedHostileError = redactToolLog(hostileError, 100_000);
        expect(JSON.stringify(redactedHostileError)).not.toContain(canary);
        expect(redactedHostileError).toMatchObject({
          name: "[Unreadable]",
          message: "[Unreadable]",
          stack: "[Unreadable]",
          cause: "[Unreadable]",
        });
      }),
      fcParams(100),
    );
  });

  it("redactToolLog is idempotent on non-truncated payloads including data fields and never splits UTF-16 surrogate pairs on truncation", () => {
    fc.assert(
      fc.property(
        fc.record({
          data: fc.string({ maxLength: 60 }),
          password: fc.string({ maxLength: 30 }),
          text: unicodeWithAstralArb,
          nested: fc.array(jsonLeafArb, { maxLength: 6 }),
        }),
        (payload) => {
          const once = redactToolLog(payload, 100_000);
          const twice = redactToolLog(once, 100_000);
          expect(twice).toStrictEqual(once);
        },
      ),
      fcParams(200),
    );

    const prettyPrinted = '{\n  "password"\n  :\n  "super_secret_pw_12345"\n}';
    const redactedPretty = redactToolLog(prettyPrinted, 100_000);
    expect(typeof redactedPretty).toBe("string");
    expect(String(redactedPretty)).not.toContain("super_secret_pw_12345");
    expect(String(redactedPretty)).toContain("[redacted]");

    fc.assert(
      fc.property(unicodeWithAstralArb, fc.integer({ min: 0, max: 120 }), (text, maxChars) => {
        const payload = { emoji: `😀🏈🚀${text}😀🏈🚀${"x".repeat(40)}` };
        const result = redactToolLog(payload, maxChars);
        if (
          typeof result === "object" &&
          result !== null &&
          "truncated" in result &&
          result.truncated === true &&
          "preview" in result &&
          typeof result.preview === "string"
        ) {
          expect(result.preview.length).toBeLessThanOrEqual(maxChars);
          expect(isWellFormedUtf16(result.preview)).toBe(true);
        }
      }),
      fcParams(300),
    );
  });

  it("createFacadeLogger emits valid single-line JSONL with zero leaked secrets even on null-prototype thrown errors", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "facade-jsonl-prop-"));
    try {
      await fc.assert(
        fc.asyncProperty(
          secretCanaryArb,
          fc.string({ maxLength: 40 }),
          async (canary, arbitraryText) => {
            const file = path.join(dir, `log-${Math.random().toString(36).slice(2)}.jsonl`);
            const logger = createFacadeLogger({
              STAGEHAND_FACADE_LOG_FILE: file,
              STAGEHAND_FACADE_LOG_LEVEL: "debug",
            });
            try {
              await logger.call(
                "1",
                "run",
                {
                  password: canary,
                  code: `const x = "${arbitraryText.replace(/["\\]/g, "")}"; // sk-abcdef${canary}`,
                },
                async () => ({
                  content: [{ type: "text", text: `https://x?apiKey=${canary}\nline2` }],
                }),
              );

              const nullErr = Object.create(null) as Record<string, unknown>;
              nullErr.secret = canary;
              await expect(
                logger.call("2", "run", {}, async () => {
                  throw nullErr;
                }),
              ).rejects.toBe(nullErr);
            } finally {
              logger.close();
            }

            const raw = await fsp.readFile(file, "utf8");
            expect(raw).not.toContain(canary);
            const lines = raw.trimEnd().split("\n");
            expect(lines.length).toBe(4);
            for (const line of lines) {
              expect(() => JSON.parse(line)).not.toThrow();
            }
          },
        ),
        fcParams(20),
      );
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("buildAllowlistedEnv strictly forwards only non-empty STAGEHAND_* and BROWSERBASE_* entries", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 20 }).map((s) => `STAGEHAND_${s}`),
            fc.string({ minLength: 1, maxLength: 20 }).map((s) => `BROWSERBASE_${s}`),
            fc.constantFrom(
              "OPENAI_API_KEY",
              "ANTHROPIC_API_KEY",
              "AWS_SECRET_ACCESS_KEY",
              "DATABASE_URL",
              "PATH",
              "constructor",
              "toString",
            ),
            fc.string({ minLength: 1, maxLength: 20 }),
          ),
          fc.oneof(fc.constant(undefined), fc.constant(""), secretCanaryArb),
          { maxKeys: 20 },
        ),
        (source) => {
          const env = buildAllowlistedEnv(source);
          for (const [key, value] of Object.entries(env)) {
            expect(/^(STAGEHAND_|BROWSERBASE_)/.test(key)).toBe(true);
            expect(value.length).toBeGreaterThan(0);
            expect(source[key]).toBe(value);
          }
          for (const [key, value] of Object.entries(source)) {
            if (/^(STAGEHAND_|BROWSERBASE_)/.test(key) && value) {
              expect(env[key]).toBe(value);
            } else {
              expect(Object.prototype.hasOwnProperty.call(env, key)).toBe(false);
            }
          }
        },
      ),
      fcParams(200),
    );
  });

  it("harnessEventLogLevel obeys error precedence, noise dropping, and bounded output levels", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 40 }),
          fc.constantFrom(
            "stream_event",
            "text-delta",
            "message_update",
            "item.updated",
            "turn.started",
            "message_end",
            "tool-call",
          ),
        ),
        fc.boolean(),
        fc.boolean(),
        (type, isError, hasContent) => {
          const level = harnessEventLogLevel(type, { isError, hasContent });
          expect([undefined, 1, 2]).toContain(level);
          if (isError) {
            expect(level).toBe(1);
          } else if (isStreamDeltaEventType(type)) {
            expect(level).toBeUndefined();
          } else if (isLifecycleBoundaryEventType(type) && !hasContent) {
            expect(level).toBeUndefined();
          } else {
            expect(level).toBe(2);
          }
        },
      ),
      fcParams(300),
    );
  });

  it("values.ts helpers preserve UTF-16 well-formedness, bounds, and crash-freedom", () => {
    fc.assert(
      fc.property(
        unicodeWithAstralArb,
        fc.oneof(fc.integer({ min: -10, max: 80 }), fc.constantFrom(0.5, 0.99, 1.5, Number.NaN)),
        (value, maxLength) => {
          const clipped = clip(value, maxLength);
          expect(isWellFormedUtf16(clipped)).toBe(true);
          if (Number.isFinite(maxLength)) {
            expect(clipped.length).toBeLessThanOrEqual(Math.max(0, Math.floor(maxLength)));
            if (Math.floor(maxLength) >= value.length && maxLength >= 0) {
              expect(clipped).toBe(value);
            }
          } else {
            expect(clipped).toBe("");
          }
        },
      ),
      fcParams(300),
    );

    expect(clip("abcdef", 0.5)).toBe("");
    expect(clip("abcdef", 0.99)).toBe("");

    const nonStringToStringFn = Object.assign(() => undefined, {
      toString: () => 42 as unknown as string,
    });
    expect(typeof stringifyError(nonStringToStringFn)).toBe("string");

    const throwingToStringFn = Object.assign(() => undefined, {
      toString: () => {
        throw new Error("boom");
      },
    });
    expect(stringifyError(throwingToStringFn)).toBe("[Unserializable error]");

    const throwingMessageErr = new Error("hidden");
    Object.defineProperty(throwingMessageErr, "message", {
      get() {
        throw new Error("getter failed");
      },
    });
    expect(stringifyError(throwingMessageErr)).toBe("[Unserializable error]");

    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.constant(Symbol("sym")),
          fc.bigInt(),
          fc.constant(Object.assign(Object.create(null), { n: 1n })),
          fc.constant({
            toJSON() {
              throw new Error("no json");
            },
            toString() {
              throw new Error("no string");
            },
          }),
        ),
        (value) => {
          const out = stringifyError(value);
          expect(typeof out).toBe("string");

          const json = safeJson(value);
          if (json !== undefined) {
            expect(() => JSON.parse(json)).not.toThrow();
          }

          expect(Number.isFinite(toFiniteNumber(value))).toBe(true);
          expect(typeof isTokenCount(value)).toBe("boolean");
          const pos = positiveInteger(value, 5);
          expect(Number.isInteger(pos) && pos >= 1).toBe(true);
        },
      ),
      fcParams(200),
    );
  });
});
