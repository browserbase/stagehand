import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod/v4";
import { JSONRPCErrorResponseSchema } from "../../json-rpc/schemas.js";
import { encodeWireValue, toWireJsonSchema, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  getStagehandMethod,
  StagehandMethods,
  StagehandNotifications,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import {
  HTTP_TRANSPORT_LIMITS,
  HTTPCancelParamsSchema,
  HTTPHeaderSchema,
  HTTPRequestErrorDataSchema,
  HTTPRequestParamsSchema,
  HTTPRequestResultSchema,
} from "../../schemas.js";
import type {
  HTTPCancelParams,
  HTTPHeader,
  HTTPRequestErrorData,
  HTTPRequestParams,
  HTTPRequestResult,
} from "../../types.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/http-transport-wire.json", import.meta.url), "utf8"),
) as {
  requests: Array<{ name: string; wire: unknown }>;
  results: Array<{ name: string; wire: unknown }>;
  cancel: unknown;
  errors: unknown[];
};

const request: HTTPRequestParams = {
  requestId: "http-1",
  configurationId: "model-1",
  scopeId: "call-1",
  method: "POST",
  path: "/v1/responses",
  headers: [],
};
const response: HTTPRequestResult = { status: 200, headers: [], bodyBase64: "" };

describe("buffered HTTP transport protocol", () => {
  it("registers the request and cancellation with canonical types", () => {
    expect(getStagehandMethod("http.request")).toBe(StagehandMethods.httpRequest);
    expect(StagehandMethods.httpRequest.params).toBe(HTTPRequestParamsSchema);
    expect(StagehandMethods.httpRequest.result).toBe(HTTPRequestResultSchema);
    expect(StagehandNotifications.httpCancel.params).toBe(HTTPCancelParamsSchema);
    expectTypeOf<HTTPRequestParams>().toEqualTypeOf<z.infer<typeof HTTPRequestParamsSchema>>();
    expectTypeOf<HTTPRequestResult>().toEqualTypeOf<z.infer<typeof HTTPRequestResultSchema>>();
    expectTypeOf<HTTPHeader>().toEqualTypeOf<z.infer<typeof HTTPHeaderSchema>>();
    expectTypeOf<HTTPCancelParams>().toEqualTypeOf<z.infer<typeof HTTPCancelParamsSchema>>();
    expectTypeOf<HTTPRequestErrorData>().toEqualTypeOf<
      z.infer<typeof HTTPRequestErrorDataSchema>
    >();
  });

  it("exports the request constraints for generated clients", () => {
    const schema = toWireJsonSchema(z.toJSONSchema(HTTPRequestParamsSchema, { io: "input" }));
    const id = { type: "string", minLength: 1, maxLength: HTTP_TRANSPORT_LIMITS.idLength };
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["request_id", "configuration_id", "scope_id", "method", "path", "headers"],
      properties: {
        request_id: id,
        configuration_id: id,
        scope_id: id,
        method: {
          type: "string",
          enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        },
        path: { type: "string", minLength: 1, maxLength: HTTP_TRANSPORT_LIMITS.pathLength },
        headers: {
          type: "array",
          maxItems: HTTP_TRANSPORT_LIMITS.headerCount,
          items: { $ref: "#/$defs/HTTPHeader" },
        },
        body_base64: {
          type: "string",
          maxLength: Math.ceil(HTTP_TRANSPORT_LIMITS.bodyBytes / 3) * 4,
          format: "byte",
          contentEncoding: "base64",
          pattern: expect.any(String),
        },
        timeout_ms: {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: HTTP_TRANSPORT_LIMITS.timeoutMs,
        },
      },
      $defs: {
        HTTPHeader: {
          type: "object",
          additionalProperties: false,
          required: ["name", "value"],
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: HTTP_TRANSPORT_LIMITS.headerNameLength,
            },
            value: { type: "string", maxLength: HTTP_TRANSPORT_LIMITS.headerValueLength },
          },
        },
      },
    });
  });

  it("exports the response constraints for generated clients", () => {
    expect(
      toWireJsonSchema(z.toJSONSchema(HTTPRequestResultSchema, { io: "input" })),
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["status", "headers", "body_base64"],
      properties: {
        status: { type: "integer", minimum: 200, maximum: 599 },
        status_text: { type: "string", maxLength: 1024 },
        headers: { type: "array", maxItems: HTTP_TRANSPORT_LIMITS.headerCount },
        body_base64: {
          type: "string",
          maxLength: Math.ceil(HTTP_TRANSPORT_LIMITS.bodyBytes / 3) * 4,
          format: "byte",
          contentEncoding: "base64",
          pattern: expect.any(String),
        },
      },
    });
  });

  it.each(fixtures.requests)("round-trips $name through the request envelope", ({ wire }) => {
    const parsed = StagehandRpcRequestSchema.parse(wire);
    expect(parsed.method).toBe("http.request");
    expect(encodeWireValue(parsed, StagehandMethods.httpRequest.paramsWire)).toStrictEqual(wire);
  });

  it.each(fixtures.results)("round-trips $name without interpreting HTTP status", ({ wire }) => {
    const parsed = wireSchema(
      StagehandMethods.httpRequest.result,
      StagehandMethods.httpRequest.resultWire,
    ).parse(wire);
    expect(encodeWireValue(parsed, StagehandMethods.httpRequest.resultWire)).toStrictEqual(wire);
  });

  it("preserves binary bytes, header order, and retry header values", () => {
    const binary = HTTPRequestResultSchema.parse({ ...response, bodyBase64: "AP+A" });
    expect([...Buffer.from(binary.bodyBase64, "base64")]).toStrictEqual([0, 255, 128]);
    const retry = wireSchema(HTTPRequestResultSchema).parse(fixtures.results[1]!.wire);
    expect(retry.headers).toStrictEqual([
      { name: "retry-after-ms", value: "125" },
      { name: "Retry-After", value: "2" },
      { name: "X-Trace", value: "First_Value" },
      { name: "X-Trace", value: "Second_Value" },
    ]);
  });

  it("keeps absent and empty request bodies distinct", () => {
    expect(HTTPRequestParamsSchema.parse(request)).not.toHaveProperty("bodyBase64");
    expect(HTTPRequestParamsSchema.parse({ ...request, bodyBase64: "" })).toHaveProperty(
      "bodyBase64",
      "",
    );
    expect(HTTPRequestParamsSchema.parse(request)).not.toHaveProperty("timeoutMs");
  });

  it("round-trips cancellation without a response or configuration payload", () => {
    const parsed = StagehandRpcNotificationSchema.parse(fixtures.cancel);
    expect(parsed.method).toBe("http.cancel");
    expect(encodeWireValue(parsed)).toStrictEqual(fixtures.cancel);
    expect(HTTPCancelParamsSchema.safeParse({ requestId: "" }).success).toBe(false);
    expect(
      HTTPCancelParamsSchema.safeParse({ requestId: "http-1", configurationId: "x" }).success,
    ).toBe(false);
  });

  it.each(fixtures.errors)("preserves typed transport errors in the JSON-RPC envelope", (wire) => {
    const parsed = JSONRPCErrorResponseSchema.parse(wire);
    expect(HTTPRequestErrorDataSchema.parse(parsed.error.data)).toStrictEqual(parsed.error.data);
  });

  it("does not encode an HTTP status as a transport failure", () => {
    expect(
      HTTPRequestErrorDataSchema.safeParse({ type: "http.request", kind: "http_429" }).success,
    ).toBe(false);
    expect(HTTPRequestResultSchema.parse({ ...response, status: 503 })).toHaveProperty(
      "status",
      503,
    );
  });

  it.each(["post", "CONNECT", "TRACE", "POST\r\n"])("rejects method %j", (method) => {
    expect(HTTPRequestParamsSchema.safeParse({ ...request, method }).success).toBe(false);
  });

  it.each(["/", "/v1/responses?apiVersion=Some_Value", "/v1/models/a%3Ab?query=https%3A%2F%2Fx"])(
    "preserves path/query %j",
    (path) => expect(HTTPRequestParamsSchema.parse({ ...request, path }).path).toBe(path),
  );

  it.each(["requestId", "configurationId", "scopeId"] as const)("bounds %s", (key) => {
    for (const value of ["", "a".repeat(HTTP_TRANSPORT_LIMITS.idLength + 1)]) {
      expect(HTTPRequestParamsSchema.safeParse({ ...request, [key]: value }).success).toBe(false);
    }
    expect(
      HTTPRequestParamsSchema.safeParse({
        ...request,
        [key]: "a".repeat(HTTP_TRANSPORT_LIMITS.idLength),
      }).success,
    ).toBe(true);
  });

  it.each([0, -1, 0.5, Infinity, NaN, HTTP_TRANSPORT_LIMITS.timeoutMs + 1])(
    "rejects timeout %s",
    (timeoutMs) =>
      expect(HTTPRequestParamsSchema.safeParse({ ...request, timeoutMs }).success).toBe(false),
  );

  it("accepts positive integer HTTP deadlines", () => {
    for (const timeoutMs of [1, 5000, HTTP_TRANSPORT_LIMITS.timeoutMs]) {
      expect(HTTPRequestParamsSchema.parse({ ...request, timeoutMs }).timeoutMs).toBe(timeoutMs);
    }
  });

  it.each([100, 199, 600, 200.5])("rejects response status %s", (status) => {
    expect(HTTPRequestResultSchema.safeParse({ ...response, status }).success).toBe(false);
  });

  it.each(["a", "YQ", "YQ=", "YQ==\n", "a===", "AA=A", "_w=="])(
    "rejects malformed body %j",
    (bodyBase64) => {
      expect(HTTPRequestParamsSchema.safeParse({ ...request, bodyBase64 }).success).toBe(false);
      expect(HTTPRequestResultSchema.safeParse({ ...response, bodyBase64 }).success).toBe(false);
    },
  );

  it("bounds encoded body lengths", () => {
    const maxBody = Buffer.alloc(HTTP_TRANSPORT_LIMITS.bodyBytes).toString("base64");
    expect(HTTPRequestParamsSchema.safeParse({ ...request, bodyBase64: maxBody }).success).toBe(
      true,
    );
    expect(
      HTTPRequestResultSchema.safeParse({ ...response, bodyBase64: maxBody + "AAAA" }).success,
    ).toBe(false);
  });

  it("bounds path length and ordered headers", () => {
    expect(HTTPRequestParamsSchema.safeParse({ ...request, path: "" }).success).toBe(false);
    expect(
      HTTPRequestParamsSchema.safeParse({
        ...request,
        path: "/" + "a".repeat(HTTP_TRANSPORT_LIMITS.pathLength),
      }).success,
    ).toBe(false);
    const header = { name: "X-Test", value: "value" };
    expect(
      HTTPRequestParamsSchema.safeParse({
        ...request,
        headers: Array.from({ length: HTTP_TRANSPORT_LIMITS.headerCount + 1 }, () => header),
      }).success,
    ).toBe(false);
  });

  it.each([
    { name: "", value: "ok" },
    { name: "x".repeat(HTTP_TRANSPORT_LIMITS.headerNameLength + 1), value: "" },
    { name: "x", value: "a".repeat(HTTP_TRANSPORT_LIMITS.headerValueLength + 1) },
  ])("rejects empty or oversized header fields %#", (header) => {
    expect(HTTPHeaderSchema.safeParse(header).success).toBe(false);
  });

  it("rejects unexpected envelope fields", () => {
    expect(
      HTTPRequestParamsSchema.safeParse({ ...request, url: "https://example.com" }).success,
    ).toBe(false);
    expect(HTTPRequestResultSchema.safeParse({ ...response, retryable: true }).success).toBe(false);
  });
});
