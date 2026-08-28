import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  assertDynamicValidationWork,
  createDynamicJsonSchemaValidator,
  relocateDynamicJsonSchemaReferences,
  validateDynamicJsonSchema,
} from "../dynamic-json-schema.js";

describe("dynamic JSON Schema boundary", () => {
  it("does not close additionalProperties inside const or enum values", () => {
    const schema = validateDynamicJsonSchema({
      type: "object",
      const: { properties: { a: 1 } },
      enum: [{ properties: { b: 2 } }],
      default: { properties: { c: 3 } },
      examples: [{ properties: { d: 4 } }],
      properties: { name: { type: "string" } },
    });

    expect(schema.additionalProperties).toBe(false);
    expect(schema.const).toEqual({ properties: { a: 1 } });
    expect(schema.enum).toEqual([{ properties: { b: 2 } }]);
    expect(schema.default).toEqual({ properties: { c: 3 } });
    expect(schema.examples).toEqual([{ properties: { d: 4 } }]);
  });

  it("accepts schemas emitted by the Python and Go SDK generators", () => {
    const fixture = (name: string) =>
      JSON.parse(
        readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
      ) as unknown;

    expect(() => validateDynamicJsonSchema(fixture("pydantic-discriminated-union"))).not.toThrow();
    expect(() => validateDynamicJsonSchema(fixture("pydantic-url-binary"))).not.toThrow();
    expect(() => validateDynamicJsonSchema(fixture("invopop-recursive-root"))).not.toThrow();
    expect(() => validateDynamicJsonSchema(fixture("invopop-bytes"))).not.toThrow();
  });

  it("accepts Zod string formats whose patterns contain nested quantifiers", () => {
    const schema = z.toJSONSchema(
      z.object({
        email: z.email(),
        encoded: z.base64(),
        address: z.ipv6(),
      }),
      { io: "input", target: "draft-2020-12" },
    );
    expect(() => validateDynamicJsonSchema(schema)).not.toThrow();
  });

  it("resolves escaped and percent-encoded JSON Pointer segments in local references", () => {
    const validator = createDynamicJsonSchemaValidator({
      type: "object",
      properties: {
        slash: {
          $defs: { "slash/type": { type: "string" } },
          $ref: "#/properties/slash/$defs/slash~1type",
        },
        tilde: {
          $defs: { "tilde~type": { type: "number" } },
          $ref: "#/properties/tilde/$defs/tilde~0type",
        },
        space: {
          $defs: { "space type": { type: "boolean" } },
          $ref: "#/properties/space/$defs/space%20type",
        },
      },
      required: ["slash", "tilde", "space"],
      additionalProperties: false,
    });

    expect(validator.validate({ slash: "yes", tilde: 1, space: true })).toEqual({
      value: { slash: "yes", tilde: 1, space: true },
    });
    expect(validator.validate({ slash: 1, tilde: "no", space: "no" }).issues).toBeDefined();
  });

  it("validates the supported discriminator annotation shape", () => {
    expect(() =>
      validateDynamicJsonSchema({
        type: "object",
        discriminator: { propertyName: "kind", unknown: true },
      }),
    ).toThrow(/discriminator\/unknown.*not supported/);
    expect(() =>
      validateDynamicJsonSchema({ type: "object", discriminator: { mapping: {} } }),
    ).toThrow(/string propertyName/);
  });

  it("rejects dynamic references before interpreter use", () => {
    const dynamicSchema = {
      $defs: { strict: { type: "string" } },
      $dynamicAnchor: "strict",
      $dynamicRef: "#/$defs/strict",
    };

    expect(() => validateDynamicJsonSchema(dynamicSchema)).toThrow(/dynamicAnchor.*not supported/);
    expect(() => createDynamicJsonSchemaValidator(dynamicSchema)).toThrow(/not supported/);
  });

  it("clones prototype-sensitive keys without invoking accessors or retaining aliases", () => {
    const properties = JSON.parse(
      '{"__proto__":{"type":"string"},"constructor":{"type":"number"},"toString":{"type":"boolean"}}',
    ) as Record<string, unknown>;
    const shared = { type: "string" };
    const source = {
      type: "object",
      properties: { ...properties, first: shared, second: shared },
    };
    const cloned = validateDynamicJsonSchema(source);

    expect(Object.hasOwn(cloned.properties as object, "__proto__")).toBe(true);
    expect(cloned).not.toBe(source);
    expect(cloned.properties).not.toBe(source.properties);
    expect((cloned.properties as Record<string, unknown>).first).not.toBe(
      (cloned.properties as Record<string, unknown>).second,
    );
    (cloned.properties as Record<string, unknown>).first = { type: "number" };
    expect((cloned.properties as Record<string, unknown>).second).toStrictEqual({
      type: "string",
    });
    expect(source.properties.first).toBe(shared);

    let getterCalled = false;
    const accessorSchema = {};
    Object.defineProperty(accessorSchema, "type", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "string";
      },
    });
    expect(() => validateDynamicJsonSchema(accessorSchema)).toThrow(/accessors/);
    expect(getterCalled).toBe(false);
    expect(() => validateDynamicJsonSchema({ type: "string", [Symbol("secret")]: true })).toThrow(
      /symbol keys/,
    );
  });

  it("bounds interpreted validation work for pathological compositions", () => {
    const schema = validateDynamicJsonSchema({
      anyOf: Array.from({ length: 100 }, () => ({
        type: "array",
        items: { type: "number" },
      })),
    });
    expect(() =>
      assertDynamicValidationWork(
        schema,
        Array.from({ length: 20_000 }, () => 1),
      ),
    ).toThrow(/work limit/);
  });

  it("rejects malformed keywords, dialects, references, and nested identifier scopes", () => {
    for (const schema of [
      { type: 42 },
      { properties: [] },
      { anyOf: [] },
      { required: ["name", "name"] },
      { minItems: -1 },
      { pattern: "[" },
    ]) {
      expect(() => validateDynamicJsonSchema(schema)).toThrow(/JSON Schema (keyword|pattern)/);
    }
    expect(() =>
      validateDynamicJsonSchema({ $schema: "http://json-schema.org/draft-07/schema#" }),
    ).toThrow(/draft 2020-12/);
    expect(() => validateDynamicJsonSchema({ $ref: "https://example.com/schema.json" })).toThrow(
      /local and self-contained/,
    );
    expect(() => validateDynamicJsonSchema({ $ref: "#/$defs/missing" })).toThrow(
      /does not resolve/,
    );
    expect(() =>
      validateDynamicJsonSchema({
        type: "object",
        properties: { child: { $id: "nested", type: "string" } },
      }),
    ).toThrow(/nested identifier scope/);
  });

  it("rejects excessive schema depth and reference chains", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 66; depth += 1) nested = { allOf: [nested] };
    expect(() => validateDynamicJsonSchema(nested)).toThrow(/maximum depth/);

    const $defs: Record<string, unknown> = {};
    for (let index = 0; index < 257; index += 1) {
      $defs[`node${index}`] =
        index === 256 ? { type: "string" } : { $ref: `#/$defs/node${index + 1}` };
    }
    expect(() => validateDynamicJsonSchema({ $ref: "#/$defs/node0", $defs })).toThrow(
      /reference chain/,
    );
  });

  it("relocates local references without mutating or decoding pointer segments", () => {
    const schema = validateDynamicJsonSchema({
      $defs: {
        "slash/name": { type: "string" },
        "tilde~name": { type: "number" },
      },
      allOf: [{ $ref: "#" }, { $ref: "#/$defs/slash~1name" }, { $ref: "#/$defs/tilde~0name" }],
    });
    const relocated = relocateDynamicJsonSchemaReferences(schema, ["properties", "a/b~c"]);

    expect(relocated.allOf).toStrictEqual([
      { $ref: "#/properties/a~1b~0c" },
      { $ref: "#/properties/a~1b~0c/$defs/slash~1name" },
      { $ref: "#/properties/a~1b~0c/$defs/tilde~0name" },
    ]);
    expect(schema.allOf).toStrictEqual([
      { $ref: "#" },
      { $ref: "#/$defs/slash~1name" },
      { $ref: "#/$defs/tilde~0name" },
    ]);
  });
});
