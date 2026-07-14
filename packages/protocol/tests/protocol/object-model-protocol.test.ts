import { describe, expect, it } from "vite-plus/test";
import {
  StagehandMethods,
  StagehandNotificationsSchema,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";

describe("Stagehand object-model protocol", () => {
  it("defines stagehand init as a JSON-RPC method", () => {
    const params = StagehandMethods["stagehand.init"].paramsSchema.parse({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      model: { provider: "openai", modelName: "openai/gpt-5-mini" },
    });

    expect(params).toStrictEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      model: { provider: "openai", modelName: "openai/gpt-5-mini" },
    });
  });

  it("rejects model names without a provider prefix", () => {
    expect(() =>
      StagehandMethods["stagehand.init"].paramsSchema.parse({
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        model: { provider: "openai", modelName: "gpt-5-mini" },
      }),
    ).toThrow();
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
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });

    expect(request).toStrictEqual({
      jsonrpc: "2.0",
      id: 4,
      method: "context.pages",
      params: {},
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
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

  it("defines notification parameter schemas in one Zod object", () => {
    expect(StagehandNotificationsSchema.shape).toHaveProperty("stagehand.log");
  });

  it("exports a JSON-RPC notification schema for generated clients", () => {
    expect(StagehandRpcNotificationSchema).toBeDefined();
  });

  it("parses a Stagehand log notification without an id", () => {
    const notification = {
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "info",
        message: "Starting action",
        data: { pageId: "page_1" },
      },
    };
    expect(StagehandRpcNotificationSchema.parse(notification)).toStrictEqual(notification);
  });

  it("rejects ids on Stagehand log notifications", () => {
    expect(() =>
      StagehandRpcNotificationSchema.parse({
        jsonrpc: "2.0",
        id: "event_1",
        method: "stagehand.log",
        params: {
          level: "info",
          message: "Starting action",
        },
      }),
    ).toThrow();
  });

  it("rejects unknown notification methods", () => {
    expect(() =>
      StagehandRpcNotificationSchema.parse({
        jsonrpc: "2.0",
        method: "stagehand.unknown",
        params: {},
      }),
    ).toThrow();
  });

  it("accepts telemetry configuration as protocol data", () => {
    expect(
      StagehandMethods["runtime.configure"].paramsSchema.parse({
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        telemetry: {
          traces: {
            endpoint: "https://otel.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
      }),
    ).toMatchObject({
      telemetry: {
        traces: { endpoint: "https://otel.example.com/v1/traces" },
      },
    });
  });
});
