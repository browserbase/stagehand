import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  createStructuredOutputContract,
  createZodStructuredOutputContract,
  providerJsonSchema,
  StructuredOutputValidationError,
} from "./structuredOutput.js";

describe("provider JSON Schema isolation", () => {
  it("clones the canonical schema independently for each provider call", () => {
    const canonical = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const first = providerJsonSchema(canonical, "openai");
    const second = providerJsonSchema(canonical, "anthropic");

    (first.properties as Record<string, unknown>).name = { type: "number" };

    expect(canonical).toStrictEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(second).toStrictEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
    expect(first).not.toBe(second);
  });

  it("attributes unsupported schemas to the selected provider", () => {
    expect(() =>
      providerJsonSchema(
        {
          type: "object",
          properties: { nested: { $id: "unsafe", type: "string" } },
        },
        "openai",
      ),
    ).toThrow(/Provider openai.*nested identifier scope/);
  });

  it("validates output with a request-local Draft 2020-12 interpreter", () => {
    const contract = createStructuredOutputContract("inventory", {
      type: "object",
      properties: { quantity: { type: "integer", minimum: 0 } },
      required: ["quantity"],
      additionalProperties: false,
    });

    expect(contract.validate({ quantity: 2 })).toMatchObject({ value: { quantity: 2 } });
    const invalid = contract.validate({ quantity: -1 });
    expect(invalid.issues).toBeDefined();
    if (!invalid.issues) return;
    expect(invalid.issues).toContainEqual(expect.objectContaining({ path: ["quantity"] }));
  });

  it("keeps describe() text and closes unspecified object additionalProperties", () => {
    const contract = createZodStructuredOutputContract(
      "article",
      z.object({
        title: z.string().describe("the main headline of the article"),
      }),
    );

    expect(contract.jsonSchema).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string", description: "the main headline of the article" },
      },
      additionalProperties: false,
    });
  });

  it("accepts Zod string formats whose patterns contain nested quantifiers", () => {
    expect(() =>
      createZodStructuredOutputContract(
        "contact",
        z.object({
          email: z.email(),
          encoded: z.base64(),
          address: z.ipv6(),
        }),
      ),
    ).not.toThrow();
  });

  it("rejects unknown assertions and custom vocabularies", () => {
    for (const schema of [
      { type: "string", customAssertion: true },
      {
        $vocabulary: { "https://example.com/custom-vocabulary": true },
        type: "string",
      },
    ]) {
      expect(() => createStructuredOutputContract("unsafe", schema)).toThrow();
    }
  });

  it("rejects direct-RPC JavaScript object attacks before interpreter construction", () => {
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.properties = cyclic;
    const inherited = Object.create({ type: "string" }) as Record<string, unknown>;
    const sparse = [] as unknown[];
    sparse.length = 2;

    for (const schema of [cyclic, inherited, { anyOf: sparse }]) {
      expect(() => createStructuredOutputContract("direct RPC", schema)).toThrow();
    }

    let invoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "type", {
      enumerable: true,
      get() {
        invoked = true;
        return "string";
      },
    });
    expect(() => createStructuredOutputContract("direct RPC", accessor)).toThrow(/accessors/);
    expect(invoked).toBe(false);
  });

  it("does not expose cfworker error classes through its owned error surface", () => {
    const contract = createStructuredOutputContract("answer", { type: "string" });
    const result = contract.validate(42);
    expect(result.issues).toBeDefined();
    if (!result.issues) return;

    const error = new StructuredOutputValidationError(result.issues);
    expect(error.name).toBe("StructuredOutputValidationError");
    expect(error.constructor.name).not.toMatch(/Validator|Schema/u);
  });

  it("rejects non-JSON and aliased values before the interpreter reads them", () => {
    const contract = createStructuredOutputContract("untrusted output", {});
    const shared = { value: 1 };
    const sparse = [] as unknown[];
    sparse.length = 1;

    expect(() => contract.validate({ first: shared, second: shared })).toThrow(/shared references/);
    expect(() => contract.validate({ value: Number.NaN })).toThrow(/JSON-safe/);
    expect(() => contract.validate(sparse)).toThrow(/sparse/);
    expect(() => contract.validate(new (class Output {})())).toThrow(/plain/);
  });
});
