import { readFile } from "node:fs/promises";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { encodeWireValue, toWireJsonSchema, wireSchema } from "../../json-rpc/wire-casing.ts";
import * as protocolSchemas from "../../schemas.ts";

const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);
const lowerChars = "abcdefghijklmnopqrstuvwxyz".split("");
const upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const digitChars = "0123456789".split("");

const lowerSegmentArb = fc
  .array(fc.constantFrom(...lowerChars), { minLength: 1, maxLength: 5 })
  .map((chars) => chars.join(""));

const optionalDigitsArb = fc
  .array(fc.constantFrom(...digitChars), { minLength: 0, maxLength: 3 })
  .map((chars) => chars.join(""));

const camelWordTailArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...upperChars), lowerSegmentArb, optionalDigitsArb)
    .map(([u, low, digs]) => `${u}${low}${digs}`),
  fc
    .tuple(
      fc.constantFrom(...upperChars),
      fc
        .array(fc.constantFrom(...digitChars), { minLength: 1, maxLength: 3 })
        .map((d) => d.join("")),
    )
    .map(([u, digs]) => `${u}${digs}`),
);

const canonicalCamelKeyArb: fc.Arbitrary<string> = fc
  .tuple(
    lowerSegmentArb,
    optionalDigitsArb,
    fc.array(camelWordTailArb, { minLength: 0, maxLength: 5 }),
    fc.option(fc.constantFrom(...upperChars), { nil: "" }),
  )
  .map(([head, headDigits, words, trailing]) => `${head}${headDigits}${words.join("")}${trailing}`);

const snakeWordTailArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...lowerChars), lowerSegmentArb, optionalDigitsArb)
    .map(([first, low, digs]) => `_${first}${low}${digs}`),
  fc
    .tuple(
      fc.constantFrom(...lowerChars),
      fc
        .array(fc.constantFrom(...digitChars), { minLength: 1, maxLength: 3 })
        .map((d) => d.join("")),
    )
    .map(([first, digs]) => `_${first}${digs}`),
);

const canonicalSnakeKeyArb: fc.Arbitrary<string> = fc
  .tuple(
    lowerSegmentArb,
    optionalDigitsArb,
    fc.array(snakeWordTailArb, { minLength: 0, maxLength: 5 }),
    fc.option(
      fc.constantFrom(...lowerChars).map((l) => `_${l}`),
      { nil: "" },
    ),
  )
  .map(([head, headDigits, words, trailing]) => `${head}${headDigits}${words.join("")}${trailing}`);

const adversarialKeyArb: fc.Arbitrary<string> = fc.oneof(
  canonicalCamelKeyArb,
  canonicalSnakeKeyArb,
  fc.constantFrom(
    "cdpURL",
    "baseURL",
    "preferCSSPageSize",
    "ignoreHTTPSErrors",
    "URL",
    "ID",
    "v2Api",
    "foo2Bar",
    "base64Encoded",
    "aA0a",
    "a2a",
    "$schema",
    "$ref",
    "_leading",
    "trailing_",
    "__double__",
    "a__b",
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "a.b",
    "a.headers",
    "",
    "0",
    "123",
  ),
  fc.string({ minLength: 0, maxLength: 16 }),
);

const jsonPrimitiveArb: fc.Arbitrary<string | number | boolean | null> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.string({ maxLength: 20 }),
);

const adversarialJsonArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { weight: 4, arbitrary: jsonPrimitiveArb },
    { weight: 2, arbitrary: fc.array(tie("value"), { maxLength: 4 }) },
    {
      weight: 3,
      arbitrary: fc
        .array(fc.tuple(adversarialKeyArb, tie("value")), { maxLength: 5 })
        .map((entries) => Object.fromEntries(entries)),
    },
  ),
})).value;

const safeOpaqueSubtreeArb: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
  record: fc
    .array(
      fc.tuple(
        adversarialKeyArb.filter((key) => key !== "__proto__"),
        fc.oneof(
          { weight: 4, arbitrary: jsonPrimitiveArb },
          { weight: 1, arbitrary: fc.array(jsonPrimitiveArb, { maxLength: 3 }) },
          { weight: 2, arbitrary: tie("record") },
        ),
      ),
      { minLength: 1, maxLength: 4 },
    )
    .map((entries) => Object.fromEntries(entries)),
})).record as fc.Arbitrary<Record<string, unknown>>;

describe("wire-casing adversarial property tests", () => {
  it("is an exact round-trip bijection on all canonical camelCase keys", () => {
    fc.assert(
      fc.property(canonicalCamelKeyArb, jsonPrimitiveArb, (apiKey, leaf) => {
        const encoded = encodeWireValue({ [apiKey]: leaf }) as Record<string, unknown>;
        const [wireKey] = Object.keys(encoded);
        expect(wireKey).toBeDefined();
        expect(wireKey).toMatch(/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/);

        const projected = toWireJsonSchema({
          type: "object",
          properties: { [apiKey]: { type: "string" } },
          required: [apiKey],
        }) as { properties: Record<string, unknown>; required: string[] };
        expect(Object.keys(projected.properties)).toStrictEqual([wireKey]);
        expect(projected.required).toStrictEqual([wireKey]);

        const decoded = wireSchema(z.record(z.string(), z.unknown())).parse(encoded);
        expect(decoded).toStrictEqual({ [apiKey]: leaf });
      }),
      { numRuns: 300 },
    );
  });

  it("is an exact round-trip bijection on all canonical snake_case keys", () => {
    fc.assert(
      fc.property(canonicalSnakeKeyArb, jsonPrimitiveArb, (wireKey, leaf) => {
        const decoded = wireSchema(z.record(z.string(), z.unknown())).parse({
          [wireKey]: leaf,
        });
        const [apiKey] = Object.keys(decoded);
        expect(apiKey).toBeDefined();

        const reencoded = encodeWireValue(decoded) as Record<string, unknown>;
        expect(reencoded).toStrictEqual({ [wireKey]: leaf });
      }),
      { numRuns: 300 },
    );
  });

  it("documents non-bijective digit-followed-by-lowercase keys from camelcase library", () => {
    const encodedCamel = encodeWireValue({ aA0a: 1 }) as Record<string, unknown>;
    expect(encodedCamel).toStrictEqual({ a_a0a: 1 });
    expect(wireSchema(z.record(z.string(), z.unknown())).parse(encodedCamel)).toStrictEqual({
      aA0A: 1,
    });

    const decodedSnake = wireSchema(z.record(z.string(), z.unknown())).parse({ a2a: 1 });
    expect(decodedSnake).toStrictEqual({ a2A: 1 });
    expect(encodeWireValue(decodedSnake)).toStrictEqual({ a2_a: 1 });
  });

  it("preserves opaque subtrees bit-for-bit at arbitrary nesting depth across encode and decode", () => {
    fc.assert(
      fc.property(
        fc.array(
          canonicalCamelKeyArb.filter(
            (key) =>
              ![
                "headers",
                "variables",
                "attributes",
                "body",
                "data",
                "userMetadata",
                "customOpaque",
                "baseURL",
              ].includes(key),
          ),
          { minLength: 0, maxLength: 4 },
        ),
        fc.constantFrom("headers", "userMetadata", "customOpaque", "baseURL"),
        safeOpaqueSubtreeArb,
        (path, opaqueKey, subtree) => {
          const options = { opaqueKeys: [opaqueKey] } as const;
          let nested: unknown = { [opaqueKey]: subtree };
          for (let i = path.length - 1; i >= 0; i -= 1) {
            nested = { [path[i]!]: nested };
          }

          const encoded = encodeWireValue(nested, options);
          const decoded = wireSchema(z.unknown(), options).parse(encoded);

          let cursor = decoded as Record<string, unknown>;
          for (const segment of path) {
            cursor = cursor[segment] as Record<string, unknown>;
          }
          expect(cursor[opaqueKey]).toEqual(subtree);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("handles transformKeys with API acronyms and opaque keys under acronym parents", () => {
    const schemaWithTransform = z.strictObject({
      data: z.strictObject({
        baseURL: z.string(),
        preferCSSPageSize: z.boolean(),
        ignoreHTTPSErrors: z.boolean(),
      }),
    });
    const decodedTransform = wireSchema(schemaWithTransform, { transformKeys: ["data"] }).parse({
      data: {
        base_url: "https://example.com",
        prefer_css_page_size: true,
        ignore_https_errors: false,
      },
    });
    expect(decodedTransform).toStrictEqual({
      data: {
        baseURL: "https://example.com",
        preferCSSPageSize: true,
        ignoreHTTPSErrors: false,
      },
    });

    const schemaWithNestedOpaque = z.strictObject({
      baseURL: z.strictObject({
        headers: z.record(z.string(), z.string()),
      }),
    });
    const decodedNestedOpaque = wireSchema(schemaWithNestedOpaque).parse({
      base_url: {
        headers: {
          "X-Api-Key": "secret",
          foo_bar: "unchanged",
        },
      },
    });
    expect(decodedNestedOpaque).toStrictEqual({
      baseURL: {
        headers: {
          "X-Api-Key": "secret",
          foo_bar: "unchanged",
        },
      },
    });

    const decodedDotted = wireSchema(z.record(z.string(), z.unknown())).parse({
      "a.headers": { page_id: "1" },
      a: { headers: { page_id: "2" } },
    });
    expect(decodedDotted).toStrictEqual({
      aHeaders: { pageId: "1" },
      a: { headers: { page_id: "2" } },
    });
  });

  it("never crashes or pollutes Object.prototype on adversarial keys, null-prototype records, collisions, or mixed arrays", () => {
    fc.assert(
      fc.property(
        adversarialJsonArb,
        fc.array(adversarialKeyArb, { maxLength: 3 }),
        fc.array(adversarialKeyArb, { maxLength: 3 }),
        (payload, opaqueKeys, transformKeys) => {
          const options = { opaqueKeys, transformKeys };
          const encoded = encodeWireValue(payload, options);
          const decoded = wireSchema(z.unknown(), options).parse(encoded);
          expect(decoded).toBeDefined();
          expect(Object.prototype).not.toHaveProperty("polluted");
          expect(Object.prototype).not.toHaveProperty("fooBar");
        },
      ),
      { numRuns: 200 },
    );

    const nullProto = Object.assign(Object.create(null), {
      pageId: "p1",
      constructor: "own-value",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      _internal: true,
    });
    const encodedNullProto = encodeWireValue(nullProto);
    expect(encodedNullProto).toEqual({
      page_id: "p1",
      constructor: "own-value",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      _internal: true,
    });
    expect(wireSchema(z.record(z.string(), z.unknown())).parse(encodedNullProto)).toEqual({
      pageId: "p1",
      constructor: "own-value",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      _internal: true,
    });

    expect(encodeWireValue([1, { pageId: "p1" }, [{ waitUntil: "load" }]])).toStrictEqual([
      1,
      { page_id: "p1" },
      [{ wait_until: "load" }],
    ]);
    expect(
      wireSchema(z.unknown()).parse([1, { page_id: "p1" }, [{ wait_until: "load" }]]),
    ).toStrictEqual([1, { pageId: "p1" }, [{ waitUntil: "load" }]]);

    const colliding = encodeWireValue({ fooBar: 1, foo_bar: 2 }) as Record<string, unknown>;
    expect(colliding).toStrictEqual({ foo_bar: 2 });

    const protoPayload = JSON.parse('{"__proto__":{"polluted":true},"page_id":"p1"}') as Record<
      string,
      unknown
    >;
    const decodedProto = wireSchema(z.unknown()).parse(protoPayload) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decodedProto)).toBe(Object.prototype);
    expect(Object.hasOwn(decodedProto, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles toWireJsonSchema safely for constructor, dependentRequired, and arbitrary schemas", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(canonicalCamelKeyArb, fc.constant({ type: "string" })), {
          minLength: 1,
          maxLength: 5,
        }),
        (entries) => {
          const keys = entries.map(([key]) => key);
          const input = {
            type: "object",
            properties: Object.fromEntries(entries),
            required: keys,
            dependentRequired: { [keys[0]!]: keys },
          };
          const projected = toWireJsonSchema(input) as {
            properties: Record<string, unknown>;
            required: string[];
            dependentRequired: Record<string, string[]>;
          };
          const wireKeys = keys.map(
            (key) => Object.keys(encodeWireValue({ [key]: 1 }) as Record<string, unknown>)[0]!,
          );
          expect(Object.keys(projected.properties)).toStrictEqual([...new Set(wireKeys)]);
          expect(projected.required).toStrictEqual(wireKeys);
          expect(projected.dependentRequired[wireKeys[0]!]).toStrictEqual(wireKeys);
        },
      ),
      { numRuns: 100 },
    );

    const withConstructor = toWireJsonSchema({
      type: "object",
      properties: { constructor: { type: "string" }, $schema: { type: "string" } },
      required: ["constructor", "$schema"],
    }) as { properties: Record<string, unknown>; required: string[] };
    expect(withConstructor).toEqual({
      type: "object",
      properties: { constructor: { type: "string" }, $schema: { type: "string" } },
      required: ["constructor", "$schema"],
    });
  });

  it("round-trips 100% of declared property names in schemas.ts and stagehand.v4.json losslessly", async () => {
    const allApiKeys = new Set<string>();
    for (const exported of Object.values(protocolSchemas)) {
      if (exported && typeof exported === "object" && "_zod" in exported) {
        try {
          collectPropertyNames(
            z.toJSONSchema(exported as z.ZodType, { io: "input", unrepresentable: "any" }),
            allApiKeys,
          );
        } catch {}
      }
    }
    expect(allApiKeys.size).toBeGreaterThan(200);

    for (const apiKey of allApiKeys) {
      const encoded = encodeWireValue({ [apiKey]: 1 }) as Record<string, unknown>;
      const [wireKey] = Object.keys(encoded);
      const projected = toWireJsonSchema({
        type: "object",
        properties: { [apiKey]: {} },
      }) as { properties: Record<string, unknown> };
      const [schemaWireKey] = Object.keys(projected.properties);
      const decoded = wireSchema(z.record(z.string(), z.unknown())).parse(encoded);
      const [roundTrippedApiKey] = Object.keys(decoded);

      expect(wireKey, `encodeWireValue and toWireJsonSchema must agree on ${apiKey}`).toBe(
        schemaWireKey,
      );
      expect(
        roundTrippedApiKey,
        `${apiKey} -> ${wireKey} must round-trip losslessly back to ${apiKey}`,
      ).toBe(apiKey);
    }

    const protocolDoc = JSON.parse(await readFile(schemaUrl, "utf8")) as Record<string, unknown>;
    const defs = protocolDoc.$defs as Record<string, unknown>;
    const wireKeysInDefs = new Set<string>();
    collectPropertyNames(defs, wireKeysInDefs);
    expect(wireKeysInDefs.size).toBeGreaterThan(200);

    for (const wireKey of wireKeysInDefs) {
      const decoded = wireSchema(z.record(z.string(), z.unknown())).parse({ [wireKey]: 1 });
      const reencoded = encodeWireValue(decoded) as Record<string, unknown>;
      const [reencodedWireKey] = Object.keys(reencoded);
      expect(
        reencodedWireKey,
        `stagehand.v4.json $defs property ${wireKey} must round-trip losslessly`,
      ).toBe(wireKey);
    }
  });
});

function collectPropertyNames(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPropertyNames(item, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.properties === "object" &&
    record.properties !== null &&
    !Array.isArray(record.properties)
  ) {
    for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
      out.add(key);
      collectPropertyNames(child, out);
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "properties") collectPropertyNames(child, out);
  }
}
