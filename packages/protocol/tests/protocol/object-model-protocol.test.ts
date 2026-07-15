import { describe, expect, it } from "vite-plus/test";
import {
  StagehandNotifications,
  StagehandRPC,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";

describe("Stagehand object-model protocol", () => {
  it("defines stagehand init as a JSON-RPC method", () => {
    const params = StagehandRPC.stagehandInit.params.parse({
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
      StagehandRPC.stagehandInit.params.parse({
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        model: { provider: "openai", modelName: "gpt-5-mini" },
      }),
    ).toThrow();
  });

  it("requires page ids for page methods", () => {
    expect(() =>
      StagehandRPC.pageGoto.params.parse({
        url: "https://example.com",
        wait_until: "load",
      }),
    ).toThrow();

    expect(
      StagehandRPC.pageGoto.params.parse({
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
      StagehandRPC.locatorTextContent.params.parse({
        pageId: "target-1",
        selector: "h1",
        nth: 2,
      }),
    ).toStrictEqual({
      pageId: "target-1",
      selector: "h1",
      nth: 2,
    });

    expect(() =>
      StagehandRPC.locatorTextContent.params.parse({
        pageId: "target-1",
        selector: "h1",
        nth: -1,
      }),
    ).toThrow();
  });

  it("defines locator parity method parameter and result schemas", () => {
    expect(StagehandRPC.locatorHover.params.parse(locatorDescriptor())).toStrictEqual(
      locatorDescriptor(),
    );
    expect(StagehandRPC.locatorHover.result.parse({ hovered: true })).toStrictEqual({
      hovered: true,
    });

    expect(StagehandRPC.locatorCount.result.parse({ count: 2 })).toStrictEqual({
      count: 2,
    });
    expect(() => StagehandRPC.locatorCount.result.parse({ count: -1 })).toThrow();

    expect(StagehandRPC.locatorIsChecked.result.parse({ checked: true })).toStrictEqual({
      checked: true,
    });
    expect(
      StagehandRPC.locatorInputValue.result.parse({ value: "user@example.com" }),
    ).toStrictEqual({ value: "user@example.com" });
    expect(StagehandRPC.locatorInnerText.result.parse({ text: "Submit" })).toStrictEqual({
      text: "Submit",
    });
    expect(StagehandRPC.locatorInnerHtml.result.parse({ html: "<b>Submit</b>" })).toStrictEqual({
      html: "<b>Submit</b>",
    });

    expect(
      StagehandRPC.locatorScrollTo.params.parse({
        ...locatorDescriptor(),
        percent: "bottom",
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      percent: "bottom",
    });
    expect(StagehandRPC.locatorCentroid.result.parse({ x: 12.5, y: 44 })).toStrictEqual({
      x: 12.5,
      y: 44,
    });

    expect(
      StagehandRPC.locatorHighlight.params.parse({
        ...locatorDescriptor(),
        options: {
          durationMs: 250,
          borderColor: { r: 255, g: 0, b: 0, a: 0.9 },
        },
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      options: {
        durationMs: 250,
        borderColor: { r: 255, g: 0, b: 0, a: 0.9 },
      },
    });

    expect(
      StagehandRPC.locatorSendClickEvent.params.parse({
        ...locatorDescriptor(),
        options: { bubbles: true, cancelable: true, composed: true, detail: 2 },
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      options: { bubbles: true, cancelable: true, composed: true, detail: 2 },
    });

    expect(
      StagehandRPC.locatorType.params.parse({
        ...locatorDescriptor(),
        text: "hello",
        options: { delay: 10 },
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      text: "hello",
      options: { delay: 10 },
    });

    expect(
      StagehandRPC.locatorSelectOption.params.parse({
        ...locatorDescriptor(),
        values: ["a", "b"],
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      values: ["a", "b"],
    });
    expect(StagehandRPC.locatorSelectOption.result.parse({ values: ["a"] })).toStrictEqual({
      values: ["a"],
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
    expect(StagehandNotifications.log.name).toBe("stagehand.log");
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
          data: {},
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
      StagehandRPC.runtimeConfigure.params.parse({
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

function locatorDescriptor() {
  return {
    pageId: "target-1",
    selector: "button",
    nth: 1,
  };
}
