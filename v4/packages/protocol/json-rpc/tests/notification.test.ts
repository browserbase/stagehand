import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import * as JSONRPCSchemas from "../schemas.ts";

function requireNotificationSchema(): z.ZodType {
  const schema = Reflect.get(JSONRPCSchemas, "JSONRPCNotificationSchema");
  expect(schema, "JSONRPCNotificationSchema must be exported").toBeDefined();
  return schema as z.ZodType;
}

function parseNotification(input: unknown): unknown {
  return requireNotificationSchema().parse(input);
}

describe("JSONRPCNotificationSchema", () => {
  describe("notification object", () => {
    it("accepts a JSON-RPC 2.0 notification containing only jsonrpc and method", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "update" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
      });
    });

    it("accepts a notification with named parameters", () => {
      expect(
        parseNotification({
          jsonrpc: "2.0",
          method: "update",
          params: { enabled: true },
        }),
      ).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
        params: { enabled: true },
      });
    });

    it("accepts a notification with positional parameters", () => {
      expect(
        parseNotification({ jsonrpc: "2.0", method: "update", params: [1, "two"] }),
      ).toStrictEqual({ jsonrpc: "2.0", method: "update", params: [1, "two"] });
    });

    it.each([
      ["null", null],
      ["a string", "notification"],
      ["a number", 1],
      ["a boolean", true],
      ["an array", []],
    ])("rejects %s as a notification object", (_name, input) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse(input)).toThrow();
    });

    it("rejects unknown top-level members as Stagehand protocol policy", () => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method: "update", extension: true })).toThrow();
    });
  });

  describe("jsonrpc", () => {
    it("requires the jsonrpc member", () => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ method: "update" })).toThrow();
    });

    it("accepts exactly the string 2.0", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "update" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
      });
    });

    it.each(["", "1.0", "2", "2.1", "02.0"])("rejects the string version %j", (jsonrpc) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc, method: "update" })).toThrow();
    });

    it.each([
      ["a number", 2],
      ["a boolean", true],
      ["null", null],
      ["an object", {}],
      ["an array", []],
    ])("rejects %s as the jsonrpc member", (_name, jsonrpc) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc, method: "update" })).toThrow();
    });
  });

  describe("method", () => {
    it("requires the method member", () => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0" })).toThrow();
    });

    it("accepts a string method name", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "stagehand.logEvent" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "stagehand.logEvent",
      });
    });

    it("preserves case-sensitive method names", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "Stagehand.LogEvent" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "Stagehand.LogEvent",
      });
    });

    it("accepts an empty method name because JSON-RPC only requires a string", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "",
      });
    });

    it("accepts rpc-prefixed method names structurally for registered system extensions", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "rpc.extension" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "rpc.extension",
      });
    });

    it.each([
      ["a number", 1],
      ["a boolean", true],
      ["null", null],
      ["an object", {}],
      ["an array", []],
    ])("rejects %s as the method member", (_name, method) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method })).toThrow();
    });
  });

  describe("params", () => {
    it("allows params to be omitted", () => {
      expect(parseNotification({ jsonrpc: "2.0", method: "update" })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
      });
    });

    it.each([
      ["empty named parameters", {}],
      ["populated named parameters", { enabled: true, count: 2 }],
      ["empty positional parameters", []],
      ["populated positional parameters", [true, 2, "three", null]],
    ])("accepts %s", (_name, params) => {
      expect(parseNotification({ jsonrpc: "2.0", method: "update", params })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
        params,
      });
    });

    it("accepts recursively nested JSON values in named parameters", () => {
      const params = {
        object: { array: [null, true, 1, "two", { nested: false }] },
      };
      expect(parseNotification({ jsonrpc: "2.0", method: "update", params })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
        params,
      });
    });

    it("accepts recursively nested JSON values in positional parameters", () => {
      const params = [[null, { nested: [true, 1, "two"] }]];
      expect(parseNotification({ jsonrpc: "2.0", method: "update", params })).toStrictEqual({
        jsonrpc: "2.0",
        method: "update",
        params,
      });
    });

    it.each([
      ["a string", "params"],
      ["a number", 1],
      ["a boolean", true],
      ["null", null],
    ])("rejects %s as params", (_name, params) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method: "update", params })).toThrow();
    });

    it.each([
      ["undefined", undefined],
      ["a bigint", 1n],
      ["a symbol", Symbol("value")],
      ["a function", () => undefined],
      ["a Date instance", new Date("2026-01-01T00:00:00.000Z")],
      ["NaN", Number.NaN],
      ["positive Infinity", Number.POSITIVE_INFINITY],
      ["negative Infinity", Number.NEGATIVE_INFINITY],
    ])("rejects %s nested inside params", (_name, value) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method: "update", params: { value } })).toThrow();
    });
  });

  describe("id", () => {
    it.each([
      ["an empty string", ""],
      ["a string", "req_1"],
      ["zero", 0],
      ["an integer", 1],
      ["a fractional number", 1.5],
      ["null", null],
      ["a boolean", true],
      ["an object", {}],
      ["an array", []],
    ])("rejects a notification containing %s as id", (_name, id) => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method: "update", id })).toThrow();
    });
  });

  describe("response-only members", () => {
    it("rejects a notification containing result", () => {
      const schema = requireNotificationSchema();
      expect(() => schema.parse({ jsonrpc: "2.0", method: "update", result: null })).toThrow();
    });

    it("rejects a notification containing error", () => {
      const schema = requireNotificationSchema();
      expect(() =>
        schema.parse({
          jsonrpc: "2.0",
          method: "update",
          error: { code: -32603, message: "Internal error" },
        }),
      ).toThrow();
    });

    it("rejects a notification containing both result and error", () => {
      const schema = requireNotificationSchema();
      expect(() =>
        schema.parse({
          jsonrpc: "2.0",
          method: "update",
          result: null,
          error: { code: -32603, message: "Internal error" },
        }),
      ).toThrow();
    });
  });
});
