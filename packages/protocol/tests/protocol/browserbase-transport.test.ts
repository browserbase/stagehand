import { describe, expect, it } from "vitest";
import fixtures from "../../../../tests/fixtures/browserbase-transport.json" with { type: "json" };
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  StagehandMethods,
  StagehandNotifications,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import {
  BrowserbaseRequestParamsSchema,
  BrowserbaseRequestResultSchema,
  STAGEHAND_PROTOCOL_VERSION,
  StagehandInitParamsSchema,
} from "../../schemas.js";

const init = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
};
const browser = { sessionId: fixtures.connection.sessionId };
const request = { operation: "gateway.responses", headers: {}, body: "{}" };
const response = { type: "response", status: 200, statusText: "OK", headers: {}, body: "" };

function roundTripResult(result: unknown) {
  return wireSchema(StagehandMethods.browserbaseRequest.result).parse(
    JSON.parse(JSON.stringify(encodeWireValue(result))),
  );
}

describe("Browserbase transport protocol", () => {
  it.each(["gateway.responses", "cache.get", "cache.set"])(
    "preserves opaque body text and header casing for %s",
    (operation) => {
      const params = {
        operation,
        headers: { "Content-Type": "application/json", "X-Custom_Header": "custom-value" },
        body: '{ "Mixed_Case": "héllo 🌎" }',
        remainingTimeoutMs: 1234.5,
      };
      const encoded = encodeWireValue(params);
      expect(encoded).toEqual({
        operation,
        headers: params.headers,
        body: params.body,
        remaining_timeout_ms: 1234.5,
      });
      const parsed = StagehandRpcRequestSchema.parse(
        JSON.parse(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "browserbase.request",
            params: encoded,
          }),
        ),
      );
      expect(parsed.params).toEqual(params);
    },
  );

  it.each([
    { operation: "other" },
    { body: {} },
    { headers: { "x-test": 123 } },
    { url: "https://example.com" },
    { path: "/v1/other" },
    { method: "GET" },
    { apiKey: "test-key" },
    { configurationId: "test-config" },
    { requestId: 7 },
    { remainingTimeoutMs: -1 },
    { remainingTimeoutMs: Infinity },
  ])("rejects an unsupported request shape: %j", (patch) => {
    expect(BrowserbaseRequestParamsSchema.safeParse({ ...request, ...patch }).success).toBe(false);
  });

  it("does not add a deadline and accepts an already exhausted caller budget", () => {
    expect(BrowserbaseRequestParamsSchema.parse(request)).not.toHaveProperty("remainingTimeoutMs");
    expect(
      BrowserbaseRequestParamsSchema.parse({ ...request, remainingTimeoutMs: 0 }),
    ).toHaveProperty("remainingTimeoutMs", 0);
  });

  it.each([
    { status: 200, body: '{ "Mixed_Case": "héllo 🌎" }' },
    { status: 429, body: "upstream error" },
    { status: 204, body: "" },
  ])("preserves opaque response text for status $status", ({ status, body }) => {
    const result = { ...response, status, body, statusText: "", headers: { "Retry-After": "2" } };
    expect(roundTripResult(result)).toEqual(result);
  });

  it.each(["network", "cancelled", "timeout", "unavailable", "disconnected"])(
    "distinguishes %s from an HTTP error response",
    (reason) => {
      const result = { type: "error", reason, message: "Request did not complete" };
      expect(roundTripResult(result)).toEqual(result);
      expect(BrowserbaseRequestResultSchema.safeParse({ ...result, status: 503 }).success).toBe(
        false,
      );
    },
  );

  it.each([
    { ...response, status: 0 },
    { ...response, status: 199 },
    { ...response, status: 600 },
    { ...response, status: 200.5 },
    { ...response, body: {} },
    { ...response, headers: { "retry-after": 10 } },
    { type: "error", reason: "http", message: "HTTP error" },
  ])("rejects an invalid result: %j", (result) => {
    expect(BrowserbaseRequestResultSchema.safeParse(result).success).toBe(false);
  });

  it.each(["cancelled", "timeout"])("cancels the original RPC request for %s", (reason) => {
    const notification = {
      jsonrpc: "2.0",
      method: StagehandNotifications.browserbaseCancel.name,
      params: { request_id: 7, reason },
    };
    expect(StagehandRpcNotificationSchema.parse(notification).params).toEqual({
      requestId: 7,
      reason,
    });
    expect(encodeWireValue({ requestId: 7, reason })).toEqual(notification.params);
  });

  it.each([-1, 0.5, "7", null])("rejects invalid cancellation ID %j", (requestId) => {
    expect(
      StagehandNotifications.browserbaseCancel.params.safeParse({ requestId, reason: "cancelled" })
        .success,
    ).toBe(false);
  });
});

describe("Browserbase transport initialization", () => {
  it("allows client transport alongside client model references", () => {
    const params = {
      ...init,
      browserbase: "client",
      browser,
      model: { source: "client" },
    };
    expect(StagehandInitParamsSchema.parse(params)).toMatchObject(params);
    expect(StagehandInitParamsSchema.parse(init)).not.toHaveProperty("browserbase");
  });

  it.each([
    { apiKey: fixtures.connection.apiKey },
    { apiUrl: "https://example.com/services" },
    { apiKey: fixtures.connection.apiKey, apiUrl: "https://example.com/services" },
  ])("rejects removed init options with or without client transport: %j", (options) => {
    for (const routing of [{}, { browserbase: "client", browser }]) {
      const params = { ...init, ...routing, ...options };
      expect(StagehandInitParamsSchema.safeParse(params).success).toBe(false);
      expect(wireSchema(StagehandInitParamsSchema).safeParse(encodeWireValue(params)).success).toBe(
        false,
      );
    }
  });

  it("allows client transport alongside direct model configuration", () => {
    const params = {
      ...init,
      browserbase: "client",
      browser,
      model: {
        modelName: "openai/gpt-5",
        apiKey: "provider-key",
        headers: { "x-custom": "value" },
      },
    };
    expect(wireSchema(StagehandInitParamsSchema).parse(encodeWireValue(params))).toMatchObject(
      params,
    );
  });

  it.each([
    { apiKey: fixtures.connection.apiKey },
    { apiUrl: "https://example.com" },
    { browser: undefined },
    { browser: { sessionId: "" } },
    { browserbase: true },
    { browserbase: { apiKey: "test" } },
  ])("rejects incomplete or mixed initialization: %j", (patch) => {
    expect(
      StagehandInitParamsSchema.safeParse({ ...init, browserbase: "client", browser, ...patch })
        .success,
    ).toBe(false);
  });
});
