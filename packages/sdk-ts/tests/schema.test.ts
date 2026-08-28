import { describe, expect, expectTypeOf, it } from "vitest";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as arktype from "arktype";
import { Schema } from "effect";
import * as valibot from "valibot";
import Type, { type Static } from "typebox";
import * as zod3 from "zod3";

import {
  jsonSchema,
  StagehandSchemaError,
  StagehandValidationError,
  type ExtractResult,
  type JsonSchemaDocument,
  type StagehandSchema,
} from "../src/index.js";
import { z } from "zod/v4";
import {
  isExtractSchemaIntent,
  resolveExtractSchema,
  standardSchemaToJsonSchema,
  validateStandardSchema,
} from "../src/schema.js";

describe("extract schema boundary", () => {
  it("types ExtractResult from the schema object", () => {
    const schema = z.object({ count: z.coerce.number() });
    expectTypeOf<ExtractResult<typeof schema>["data"]>().toEqualTypeOf<{ count: number }>();
    expectTypeOf<ExtractResult<StagehandSchema<string, number>>["data"]>().toEqualTypeOf<number>();
    expectTypeOf<ExtractResult<number>["data"]>().toEqualTypeOf<number>();
  });

  it("accepts complete JSON Schema documents", () => {
    const source = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    } as const satisfies JsonSchemaDocument;
    const document: JsonSchemaDocument = standardSchemaToJsonSchema(jsonSchema(source), "input");

    expect(document).toMatchObject({
      type: "object",
      properties: source.properties,
      required: ["name"],
    });
  });

  it("adapts TypeBox schemas without casts and preserves generic output typing", async () => {
    const ProductJsonSchema = Type.Object({
      name: Type.String(),
      price: Type.Number(),
      note: Type.Optional(Type.String()),
    });
    const productSchema = jsonSchema<Static<typeof ProductJsonSchema>>(ProductJsonSchema);
    const resolved = resolveExtractSchema(productSchema);

    const product: Static<typeof ProductJsonSchema> = await resolved.validate({
      name: "widget",
      price: 12,
    });
    expect(product).toEqual({ name: "widget", price: 12 });
    expect(resolveExtractSchema(productSchema).jsonSchema.required).toEqual(["name", "price"]);
    await expect(resolved.validate({ name: "widget", price: "free" })).resolves.toEqual({
      name: "widget",
      price: "free",
    });
  });

  it("adapts hand-written schemas with local and escaped references", async () => {
    const document = {
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
      },
      required: ["slash", "tilde"],
      additionalProperties: false,
    } as const;
    const schema = jsonSchema<{ slash: string; tilde: number }>(document);

    expect(standardSchemaToJsonSchema(schema, "input")).toMatchObject({
      properties: {
        slash: { $ref: "#/properties/slash/$defs/slash~1type" },
        tilde: { $ref: "#/properties/tilde/$defs/tilde~0type" },
      },
    });
    await expect(validateStandardSchema(schema, { slash: "yes", tilde: 1 })).resolves.toEqual({
      slash: "yes",
      tilde: 1,
    });
  });

  it("stores an isolated canonical schema and returns a fresh clone per conversion", () => {
    const source = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    } as const;
    const schema = jsonSchema(source);
    const first = standardSchemaToJsonSchema(schema, "input");
    const second = standardSchemaToJsonSchema(schema, "output");

    expect(first).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: source.properties,
      required: ["name"],
      additionalProperties: false,
    });
    expect(first).not.toBe(source);
    expect(first).not.toBe(second);
    (source.properties.name as { type: string }).type = "number";
    (first.properties as Record<string, unknown>).name = { type: "boolean" };
    expect(standardSchemaToJsonSchema(schema, "input")).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("rejects unsupported adapter targets and malformed raw schemas", () => {
    const schema = jsonSchema({ type: "object", properties: { value: { type: "string" } } });
    expect(() => schema["~standard"].jsonSchema.input({ target: "draft-07" })).toThrow(
      /only support.*draft-2020-12/,
    );
    expect(() => jsonSchema({ type: 42 } as never)).not.toThrow();
    expect(() => jsonSchema(true as never)).toThrow(/return an object/);
  });

  it("treats defaults as annotations", async () => {
    const defaults = jsonSchema<{ page: number }>({
      type: "object",
      properties: { page: { type: "number", default: 1 } },
      required: ["page"],
    });
    await expect(validateStandardSchema(defaults, { page: 2 })).resolves.toEqual({ page: 2 });
    await expect(validateStandardSchema(defaults, {})).resolves.toEqual({});
  });

  it("generates the model schema from the validator input", async () => {
    const schema = z.object({
      length: z.string().transform((value) => value.length),
      page: z.number().default(1),
    });

    const resolved = resolveExtractSchema(schema);

    expect(resolved.jsonSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {
        length: { type: "string" },
        page: { default: 1, type: "number" },
      },
      required: ["length"],
    });
    await expect(resolved.validate({ length: "hello" })).resolves.toEqual({
      length: 5,
      page: 1,
    });
  });

  it("keeps describe() text and z.email() on Zod extract schemas", () => {
    const schema = z.object({
      title: z.string().describe("the main headline of the article"),
      email: z.email(),
      encoded: z.base64(),
    });
    const resolved = resolveExtractSchema(schema);

    expect(resolved.jsonSchema).toMatchObject({
      properties: {
        title: { type: "string", description: "the main headline of the article" },
        email: { type: "string", format: "email" },
      },
    });
  });

  it("awaits async Standard Schema validators", async () => {
    const schema = dualStandardSchema<string, number>({
      validate: async (value) =>
        typeof value === "string"
          ? { value: value.length }
          : { issues: [{ message: "Expected a string" }] },
      input: { type: "string" },
      output: { type: "number" },
    });

    const resolved = resolveExtractSchema(schema);
    await expect(resolved.validate("hello")).resolves.toBe(5);
  });

  it("recognizes callable dual-standard schemas", () => {
    const schema = Object.assign(
      () => undefined,
      dualStandardSchema({
        validate: (value) => ({ value }),
        input: { type: "string" },
        output: { type: "string" },
      }),
    );

    expect(isExtractSchemaIntent(schema)).toBe(true);
    expect(resolveExtractSchema(schema).jsonSchema).toEqual({ type: "string" });
  });

  it("accepts ArkType through its native standard capabilities", async () => {
    const schema = arktype.type({ name: "string", "quantity?": "number >= 0" });
    const resolved = resolveExtractSchema(schema);

    expect(resolved.jsonSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["name"],
    });
    await expect(resolved.validate({ name: "widget", quantity: 2 })).resolves.toEqual({
      name: "widget",
      quantity: 2,
    });
  });

  it("accepts Effect through its native standard capabilities", async () => {
    const schema = Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String })),
    );
    const resolved = resolveExtractSchema(schema);

    expect(resolved.jsonSchema).toMatchObject({ type: "object", required: ["name"] });
    await expect(resolved.validate({ name: "widget" })).resolves.toEqual({ name: "widget" });
    await expect(resolved.validate({ name: 1 })).rejects.toBeInstanceOf(StagehandValidationError);
  });

  it("accepts Valibot through its official Standard JSON Schema adapter", async () => {
    const schema = toStandardJsonSchema(
      valibot.object({
        name: valibot.string(),
        quantity: valibot.optional(valibot.number(), 1),
      }),
    );
    const resolved = resolveExtractSchema(schema);

    expect(resolved.jsonSchema).toMatchObject({
      type: "object",
      required: ["name"],
    });
    await expect(resolved.validate({ name: "widget" })).resolves.toEqual({
      name: "widget",
      quantity: 1,
    });
  });

  it("runs Zod coercions, refinements, and async refinements after RPC", async () => {
    const schema = z.object({
      count: z.coerce.number().int().positive(),
      slug: z
        .string()
        .refine((value) => value.includes("-"), "Expected a slug")
        .refine(async (value) => value !== "blocked-slug", "Slug is blocked"),
    });
    const resolved = resolveExtractSchema(schema);

    await expect(resolved.validate({ count: "2", slug: "good-slug" })).resolves.toEqual({
      count: 2,
      slug: "good-slug",
    });
    await expect(resolved.validate({ count: "2", slug: "blocked-slug" })).rejects.toBeInstanceOf(
      StagehandValidationError,
    );
  });

  it("preserves Standard Schema issues on validation errors", async () => {
    const resolved = resolveExtractSchema(z.object({ price: z.number() }));

    try {
      await resolved.validate({ price: "free" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StagehandValidationError);
      expect((error as StagehandValidationError).issues[0]).toMatchObject({
        message: expect.any(String),
        path: ["price"],
      });
    }
  });

  it("preserves structured Standard Schema issue path segments", async () => {
    const issue = {
      message: "Invalid nested value",
      path: ["items", 2, { key: "price" }] as const,
    };
    const resolved = resolveExtractSchema(
      dualStandardSchema({
        validate: () => ({ issues: [issue] }),
        input: { type: "array" },
        output: { type: "array" },
      }),
    );

    await expect(resolved.validate([])).rejects.toMatchObject({ issues: [issue] });
  });

  it("preserves failures thrown by async validators as their cause", async () => {
    const cause = new Error("validator crashed");
    const resolved = resolveExtractSchema(
      dualStandardSchema({
        validate: async () => {
          throw cause;
        },
        input: { type: "string" },
        output: { type: "string" },
      }),
    );

    await expect(resolved.validate("value")).rejects.toBe(cause);
  });

  it("rejects partial standard capabilities", () => {
    const validateOnly = {
      "~standard": {
        version: 1,
        vendor: "validate-only",
        validate: (value: unknown) => ({ value }),
      },
    };
    const jsonSchemaOnly = {
      "~standard": {
        version: 1,
        vendor: "json-only",
        jsonSchema: {
          input: () => ({ type: "string" }),
          output: () => ({ type: "string" }),
        },
      },
    };

    expect(isExtractSchemaIntent(validateOnly)).toBe(true);
    expect(() => resolveExtractSchema(validateOnly)).toThrow(/Standard JSON Schema/);
    expect(() => resolveExtractSchema(jsonSchemaOnly)).toThrow(/validation/);
  });

  it("rejects Zod versions without native dual-standard support", () => {
    expect(() => resolveExtractSchema(zod3.object({ name: zod3.string() }))).toThrow(
      /Zod 4\.2\.0 or newer/,
    );
  });

  it("gives official adapter guidance to validate-only Valibot schemas", () => {
    expect(() => resolveExtractSchema(valibot.object({ name: valibot.string() }))).toThrow(
      /toStandardJsonSchema/,
    );
  });

  it("gives official adapter guidance to validate-only Effect schemas", () => {
    expect(() =>
      resolveExtractSchema(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String }))),
    ).toThrow(/toStandardJSONSchemaV1/);
  });

  it("rejects schemas without a vendor before RPC", () => {
    const schema = dualStandardSchema({
      validate: (value) => ({ value }),
      input: { type: "string" },
      output: { type: "string" },
    });
    Object.defineProperty(schema["~standard"], "vendor", { value: "" });

    expect(() => resolveExtractSchema(schema)).toThrow(/vendor name/);
  });

  it("rejects unsupported standard versions", () => {
    const schema = dualStandardSchema({
      validate: (value) => ({ value }),
      input: { type: "string" },
      output: { type: "string" },
    });
    Object.defineProperty(schema["~standard"], "version", { value: 2 });

    expect(() => resolveExtractSchema(schema)).toThrow(/version 1/);
  });

  it("adds vendor and target context to converter failures", () => {
    const schema = failingSchema(() => {
      throw new Error("unsupported target");
    });

    try {
      resolveExtractSchema(schema);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StagehandSchemaError);
      expect((error as StagehandSchemaError).vendor).toBe("broken-converter");
      expect((error as Error).message).toContain("draft-2020-12");
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it("rejects malformed converter output and unsupported inputs", () => {
    expect(() => resolveExtractSchema(failingSchema(() => "not an object"))).toThrow(
      /return an object/,
    );
    expect(() =>
      resolveExtractSchema(
        failingSchema(() => {
          const cyclic: Record<string, unknown> = { type: "string" };
          cyclic.self = cyclic;
          return cyclic;
        }),
      ),
    ).toThrow(/JSON-safe/);
    expect(() => resolveExtractSchema({ type: "string" })).toThrow(/jsonSchema/);
    expect(isExtractSchemaIntent({ type: "string" })).toBe(false);
  });
});

function dualStandardSchema<Input, Output>(config: {
  validate: import("@standard-schema/spec").StandardSchemaV1.Props<Input, Output>["validate"];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}): StagehandSchema<Input, Output> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      types: undefined,
      validate: config.validate,
      jsonSchema: {
        input: () => config.input,
        output: () => config.output,
      },
    },
  };
}

function failingSchema(convert: () => unknown): unknown {
  return {
    "~standard": {
      version: 1,
      vendor: "broken-converter",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: convert, output: convert },
    },
  };
}
