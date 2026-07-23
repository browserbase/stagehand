import { describe, expect, it } from "vite-plus/test";
import { JSONRPCRequestSchema } from "../schemas.ts";

describe("JSONRPCRequestSchema", () => {
  it("accepts a call with an integer id", () => {
    const request = { jsonrpc: "2.0", id: 1, method: "subtract", params: [42, 23] };
    expect(JSONRPCRequestSchema.parse(request)).toStrictEqual(request);
  });

  it("accepts optional W3C trace context on a request", () => {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "subtract",
      params: [42, 23],
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    };

    expect(JSONRPCRequestSchema.parse(request)).toStrictEqual(request);
  });

  it.each([
    ["traceparent", 1],
    ["tracestate", { vendor: "value" }],
  ])("rejects a non-string %s", (field, value) => {
    expect(() =>
      JSONRPCRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "subtract",
        [field]: value,
      }),
    ).toThrow();
  });

  it("rejects a notification without an id", () => {
    const request = { jsonrpc: "2.0", method: "update", params: { enabled: true } };
    expect(() => JSONRPCRequestSchema.parse(request)).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() =>
      JSONRPCRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "subtract",
        extra: true,
      }),
    ).toThrow();
  });

  it("requires jsonrpc", () => {
    expect(() => JSONRPCRequestSchema.parse({ id: 1, method: "subtract" })).toThrow();
  });

  it.each(["", "1.0", "2", "2.1"])("rejects jsonrpc version %j", (jsonrpc) => {
    expect(() => JSONRPCRequestSchema.parse({ jsonrpc, id: 1, method: "subtract" })).toThrow();
  });

  it("requires method", () => {
    expect(() => JSONRPCRequestSchema.parse({ jsonrpc: "2.0", id: 1 })).toThrow();
  });

  it.each([
    ["a number", 1],
    ["a boolean", true],
    ["null", null],
    ["an object", {}],
    ["an array", []],
  ])("rejects %s as method", (_name, method) => {
    expect(() => JSONRPCRequestSchema.parse({ jsonrpc: "2.0", id: 1, method })).toThrow();
  });

  it.each([
    ["empty named params", {}],
    ["populated named params", { subtrahend: 23, minuend: 42 }],
    ["empty positional params", []],
    ["populated positional params", [42, 23]],
  ])("accepts %s", (_name, params) => {
    const request = { jsonrpc: "2.0", id: 1, method: "subtract", params };
    expect(JSONRPCRequestSchema.parse(request)).toStrictEqual(request);
  });

  it.each([
    ["a string", "params"],
    ["a number", 1],
    ["a boolean", true],
    ["null", null],
  ])("rejects %s as params", (_name, params) => {
    expect(() =>
      JSONRPCRequestSchema.parse({ jsonrpc: "2.0", id: 1, method: "subtract", params }),
    ).toThrow();
  });

  it.each([
    ["undefined", undefined],
    ["a bigint", 1n],
    ["a symbol", Symbol("value")],
    ["a function", () => undefined],
    ["a Date instance", new Date("2026-01-01T00:00:00.000Z")],
    ["NaN", Number.NaN],
    ["positive Infinity", Number.POSITIVE_INFINITY],
  ])("rejects %s nested inside params", (_name, value) => {
    expect(() =>
      JSONRPCRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "subtract",
        params: { value },
      }),
    ).toThrow();
  });

  it.each([
    ["a string", "1"],
    ["a negative integer", -1],
    ["a fractional number", 1.5],
    ["null", null],
    ["a boolean", true],
    ["an object", {}],
    ["an array", []],
  ])("rejects %s as id", (_name, id) => {
    expect(() => JSONRPCRequestSchema.parse({ jsonrpc: "2.0", id, method: "subtract" })).toThrow();
  });
});
