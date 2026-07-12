import { describe, expect, it } from "vite-plus/test";
import * as StagehandRegistry from "../../schema-registry.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";

describe("Stagehand object-model protocol", () => {
  it("defines stagehand init as a JSON-RPC method", () => {
    const params = StagehandMethods["stagehand.init"].paramsSchema.parse({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      model: { provider: "openai", modelName: "gpt-5-mini" },
    });

    expect(params).toStrictEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      model: { provider: "openai", modelName: "gpt-5-mini" },
    });
  });

  it("requires page ids for page methods", () => {
    expect(() =>
      StagehandMethods["page.goto"].paramsSchema.parse({
        url: "https://example.com",
        wait_until: "load",
      }),
    ).toThrow();

    expect(
      StagehandMethods["page.goto"].paramsSchema.parse({
        pageId: "target-1",
        url: "https://example.com",
        options: { waitUntil: "load", timeoutMs: 10_000 },
      }),
    ).toStrictEqual({
      pageId: "target-1",
      url: "https://example.com",
      options: { waitUntil: "load", timeoutMs: 10_000 },
    });
  });

  it("keeps locators as page-scoped descriptors", () => {
    expect(
      StagehandMethods["locator.text_content"].paramsSchema.parse({
        pageId: "target-1",
        selector: "h1",
      }),
    ).toStrictEqual({
      pageId: "target-1",
      selector: "h1",
    });
  });

  it("exports a JSON-RPC request schema for generated clients", () => {
    const request = StagehandRpcRequestSchema.parse({
      jsonrpc: "2.0",
      id: 4,
      method: "context.pages",
      params: {},
    });

    expect(request).toStrictEqual({
      jsonrpc: "2.0",
      id: 4,
      method: "context.pages",
      params: {},
    });
  });

  it("requires ids for command requests", () => {
    expect(() =>
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        method: "context.pages",
        params: {},
      }),
    ).toThrow();
  });

  it("registers stagehand.log_event as a server-to-client notification", () => {
    const notifications = Reflect.get(StagehandRegistry, "StagehandNotifications");
    expect(notifications).toBeDefined();
    expect(notifications).toHaveProperty("stagehand.log_event");
  });

  it("exports a JSON-RPC notification schema for generated clients", () => {
    const notificationSchema = Reflect.get(StagehandRegistry, "StagehandRpcNotificationSchema");
    expect(notificationSchema).toBeDefined();
  });

  it("parses stagehand.log_event without an id", () => {
    const notificationSchema = Reflect.get(StagehandRegistry, "StagehandRpcNotificationSchema") as {
      parse(input: unknown): unknown;
    };
    expect(notificationSchema).toBeDefined();

    const notification = {
      jsonrpc: "2.0",
      method: "stagehand.log_event",
      params: {
        request_id: "req_123",
        method: "stagehand.act",
        event_name: "stagehand.act.started",
        timestamp: "2026-07-10T17:00:00.000Z",
        severity_number: 9,
        body: "Starting action",
      },
    };
    expect(notificationSchema.parse(notification)).toStrictEqual({
      ...notification,
      params: {
        requestId: "req_123",
        method: "stagehand.act",
        eventName: "stagehand.act.started",
        timestamp: "2026-07-10T17:00:00.000Z",
        severityNumber: 9,
        body: "Starting action",
      },
    });
  });

  it("rejects ids on stagehand.log_event notifications", () => {
    const notificationSchema = Reflect.get(StagehandRegistry, "StagehandRpcNotificationSchema") as {
      parse(input: unknown): unknown;
    };
    expect(notificationSchema).toBeDefined();
    expect(() =>
      notificationSchema.parse({
        jsonrpc: "2.0",
        id: "event_1",
        method: "stagehand.log_event",
        params: {
          request_id: "req_123",
          method: "stagehand.act",
          event_name: "stagehand.act.started",
          timestamp: "2026-07-10T17:00:00.000Z",
          severity_number: 9,
          body: "Starting action",
        },
      }),
    ).toThrow();
  });

  it("rejects unknown notification methods", () => {
    const notificationSchema = Reflect.get(StagehandRegistry, "StagehandRpcNotificationSchema") as {
      parse(input: unknown): unknown;
    };
    expect(notificationSchema).toBeDefined();
    expect(() =>
      notificationSchema.parse({
        jsonrpc: "2.0",
        method: "stagehand.unknown",
        params: {},
      }),
    ).toThrow();
  });
});
