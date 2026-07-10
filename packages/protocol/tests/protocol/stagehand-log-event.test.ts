import { describe, expect, it } from "vite-plus/test";
import * as NotificationSchemas from "../../schemas.js";

const validLogEvent = {
  requestId: "req_123",
  method: "stagehand.act",
  eventName: "stagehand.act.started",
  timestamp: "2026-07-10T17:00:00.000Z",
  severityNumber: 9,
  body: "Starting action",
};

function requireLogEventSchema() {
  const schema = Reflect.get(NotificationSchemas, "StagehandLogEventSchema");
  expect(schema, "StagehandLogEventSchema must be exported").toBeDefined();
  return schema as { parse(input: unknown): unknown };
}

describe("StagehandLogEventSchema", () => {
  it("accepts a minimal Stagehand log event", () => {
    expect(requireLogEventSchema().parse(validLogEvent)).toStrictEqual(validLogEvent);
  });

  it("accepts an integer JSON-RPC request id", () => {
    expect(requireLogEventSchema().parse({ ...validLogEvent, requestId: 1 })).toStrictEqual({
      ...validLogEvent,
      requestId: 1,
    });
  });

  it.each([1, 9, 24])("accepts OpenTelemetry severity number %s", (severityNumber) => {
    expect(requireLogEventSchema().parse({ ...validLogEvent, severityNumber })).toStrictEqual({
      ...validLogEvent,
      severityNumber,
    });
  });

  it("accepts optional OpenTelemetry log fields", () => {
    const event = {
      ...validLogEvent,
      severityText: "INFO",
      attributes: {
        pageId: "page_1",
        attempt: 1,
        nested: { visible: true },
      },
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    };
    expect(requireLogEventSchema().parse(event)).toStrictEqual(event);
  });

  it("accepts a trace id without a span id", () => {
    const event = {
      ...validLogEvent,
      traceId: "0af7651916cd43dd8448eb211c80319c",
    };
    expect(requireLogEventSchema().parse(event)).toStrictEqual(event);
  });

  it("accepts structured JSON as the log body", () => {
    const event = {
      ...validLogEvent,
      body: { message: "Starting action", selectors: ["button", null] },
    };
    expect(requireLogEventSchema().parse(event)).toStrictEqual(event);
  });

  it.each(["requestId", "method", "eventName", "timestamp", "severityNumber", "body"])(
    "requires %s",
    (field) => {
      const schema = requireLogEventSchema();
      const event = { ...validLogEvent } as Record<string, unknown>;
      delete event[field];
      expect(() => schema.parse(event)).toThrow();
    },
  );

  it.each([
    ["null", null],
    ["a fractional number", 1.5],
    ["a boolean", true],
    ["an object", {}],
    ["an array", []],
  ])("rejects %s as requestId", (_name, requestId) => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, requestId })).toThrow();
  });

  it.each([0, 25, 1.5])("rejects invalid OpenTelemetry severity number %s", (severityNumber) => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, severityNumber })).toThrow();
  });

  it("rejects an empty event name", () => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, eventName: "" })).toThrow();
  });

  it("rejects a timestamp without an offset", () => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, timestamp: "2026-07-10T17:00:00" })).toThrow();
  });

  it("rejects a span id without a trace id", () => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, spanId: "b7ad6b7169203331" })).toThrow();
  });

  it.each([
    ["an uppercase trace id", "0AF7651916CD43DD8448EB211C80319C"],
    ["a short trace id", "0af76519"],
    ["an all-zero trace id", "00000000000000000000000000000000"],
  ])("rejects %s", (_name, traceId) => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, traceId })).toThrow();
  });

  it.each([
    ["an uppercase span id", "B7AD6B7169203331"],
    ["a short span id", "b7ad6b71"],
    ["an all-zero span id", "0000000000000000"],
  ])("rejects %s", (_name, spanId) => {
    const schema = requireLogEventSchema();
    expect(() =>
      schema.parse({
        ...validLogEvent,
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId,
      }),
    ).toThrow();
  });

  it.each([
    ["a bigint body", { body: 1n }],
    ["a function body", { body: () => undefined }],
    ["non-JSON attributes", { attributes: { value: undefined } }],
  ])("rejects %s", (_name, invalid) => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, ...invalid })).toThrow();
  });

  it("rejects unknown members as Stagehand protocol policy", () => {
    const schema = requireLogEventSchema();
    expect(() => schema.parse({ ...validLogEvent, unknown: true })).toThrow();
  });
});
