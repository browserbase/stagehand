import { describe, expect, it } from "vite-plus/test";
import { JSONRPCResponseSchema } from "../schemas.ts";

describe("JSONRPCResponseSchema", () => {
  it("accepts success responses", () => {
    expect(
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("accepts error responses", () => {
    expect(
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32602,
          message: "Invalid params",
          data: { type: "stagehand.invalid_params" },
        },
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "Invalid params",
        data: { type: "stagehand.invalid_params" },
      },
    });
  });

  it("rejects responses without result or error", () => {
    expect(() =>
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
      }),
    ).toThrow();
  });

  it("rejects responses with both result and error", () => {
    expect(() =>
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
        error: {
          code: -32602,
          message: "Invalid params",
          data: { type: "stagehand.invalid_params" },
        },
      }),
    ).toThrow();
  });

  it("requires jsonrpc", () => {
    expect(() => JSONRPCResponseSchema.parse({ id: 1, result: null })).toThrow();
  });

  it.each(["", "1.0", "2", "2.1"])("rejects jsonrpc version %j", (jsonrpc) => {
    expect(() => JSONRPCResponseSchema.parse({ jsonrpc, id: 1, result: null })).toThrow();
  });

  it.each([
    ["a string", "result"],
    ["a number", 1],
    ["a boolean", true],
    ["null", null],
    ["an object", { ok: true }],
    ["an array", [1, "two"]],
  ])("accepts %s as a success result", (_name, result) => {
    expect(JSONRPCResponseSchema.parse({ jsonrpc: "2.0", id: 1, result })).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      result,
    });
  });

  it.each([
    ["undefined", undefined],
    ["a bigint", 1n],
    ["a symbol", Symbol("result")],
    ["a function", () => undefined],
    ["a Date instance", new Date("2026-01-01T00:00:00.000Z")],
    ["NaN", Number.NaN],
    ["positive Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s as a success result", (_name, result) => {
    expect(() => JSONRPCResponseSchema.parse({ jsonrpc: "2.0", id: 1, result })).toThrow();
  });

  it("accepts a nonnegative integer as a success response id", () => {
    const id = 1;
    expect(JSONRPCResponseSchema.parse({ jsonrpc: "2.0", id, result: null })).toStrictEqual({
      jsonrpc: "2.0",
      id,
      result: null,
    });
  });

  it.each(["1", -1, null, 1.5, true, {}, []])("rejects %j as a success response id", (id) => {
    expect(() => JSONRPCResponseSchema.parse({ jsonrpc: "2.0", id, result: null })).toThrow();
  });

  it.each([1, null])("accepts %j as an error response id", (id) => {
    expect(
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request" },
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it.each(["1", -1, 1.5, true, {}, []])("rejects %j as an error response id", (id) => {
    expect(() =>
      JSONRPCResponseSchema.parse({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request" },
      }),
    ).toThrow();
  });
});

describe("JSON-RPC batch schemas", () => {
  it("rejects an empty request batch", async () => {
    const { JSONRPCRequestBatchSchema } = await import("../schemas.ts");
    expect(() => JSONRPCRequestBatchSchema.parse([])).toThrow();
  });

  it("accepts a mixed batch of calls and notifications", async () => {
    const { JSONRPCRequestBatchSchema } = await import("../schemas.ts");
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "sum", params: [1, 2] },
      { jsonrpc: "2.0", method: "notify", params: { ready: true } },
    ];
    expect(JSONRPCRequestBatchSchema.parse(batch)).toStrictEqual(batch);
  });

  it("rejects an empty response batch", async () => {
    const { JSONRPCResponseBatchSchema } = await import("../schemas.ts");
    expect(() => JSONRPCResponseBatchSchema.parse([])).toThrow();
  });

  it("accepts a non-empty response batch", async () => {
    const { JSONRPCResponseBatchSchema } = await import("../schemas.ts");
    const batch = [{ jsonrpc: "2.0", id: 1, result: 3 }];
    expect(JSONRPCResponseBatchSchema.parse(batch)).toStrictEqual(batch);
  });
});
