import { describe, expect, it } from "vite-plus/test";
import * as JSONRPCErrors from "../schemas.ts";

function requireErrorObjectSchema() {
  const schema = Reflect.get(JSONRPCErrors, "JSONRPCErrorObjectSchema");
  expect(schema, "JSONRPCErrorObjectSchema must be exported").toBeDefined();
  return schema as { parse(input: unknown): unknown };
}

describe("JSONRPCErrorObjectSchema", () => {
  it("accepts an error object without data", () => {
    expect(
      requireErrorObjectSchema().parse({ code: -32602, message: "Invalid params" }),
    ).toStrictEqual({ code: -32602, message: "Invalid params" });
  });

  it.each([-32700, -32600, -32601, -32602, -32603, -32000, -32099, 1])(
    "accepts the integer error code %s",
    (code) => {
      expect(requireErrorObjectSchema().parse({ code, message: "Error" })).toStrictEqual({
        code,
        message: "Error",
      });
    },
  );

  it.each([
    ["a string", "details"],
    ["a number", 1],
    ["a boolean", true],
    ["null", null],
    ["an object", { reason: "invalid" }],
    ["an array", ["invalid", 1]],
  ])("accepts %s as error data", (_name, data) => {
    expect(
      requireErrorObjectSchema().parse({ code: -32602, message: "Error", data }),
    ).toStrictEqual({ code: -32602, message: "Error", data });
  });

  it("requires code", () => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ message: "Error" })).toThrow();
  });

  it("requires message", () => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ code: -32602 })).toThrow();
  });

  it.each([
    ["a fractional number", -32602.5],
    ["NaN", Number.NaN],
    ["positive Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
    ["a string", "-32602"],
    ["a boolean", true],
    ["null", null],
    ["an object", {}],
    ["an array", []],
  ])("rejects %s as code", (_name, code) => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ code, message: "Error" })).toThrow();
  });

  it.each([
    ["a number", 1],
    ["a boolean", true],
    ["null", null],
    ["an object", {}],
    ["an array", []],
  ])("rejects %s as message", (_name, message) => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ code: -32602, message })).toThrow();
  });

  it.each([
    ["a bigint", 1n],
    ["a symbol", Symbol("data")],
    ["a function", () => undefined],
    ["a Date instance", new Date("2026-01-01T00:00:00.000Z")],
    ["NaN", Number.NaN],
    ["positive Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s as error data", (_name, data) => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ code: -32602, message: "Error", data })).toThrow();
  });

  it("rejects unknown members as Stagehand protocol policy", () => {
    const schema = requireErrorObjectSchema();
    expect(() => schema.parse({ code: -32602, message: "Error", retryable: false })).toThrow();
  });
});
