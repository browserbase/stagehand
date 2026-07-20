import { describe, expect, it } from "vite-plus/test";
import {
  StagehandMethodSchema,
  StagehandNotifications,
  StagehandMethods,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";

describe("Stagehand object-model protocol", () => {
  it("derives every Stagehand method name from the RPC definitions", () => {
    expect(StagehandMethodSchema.options).toStrictEqual(
      Object.values(StagehandMethods).map((method) => method.name),
    );
  });

  it("defines stagehand init as a JSON-RPC method", () => {
    const params = StagehandMethods.stagehandInit.params.parse({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
        userMetadata: { suite: "smoke" },
      },
      model: { modelName: "openai/gpt-5-mini" },
    });

    expect(params).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
        userMetadata: { suite: "smoke" },
      },
      model: { modelName: "openai/gpt-5-mini" },
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
  });

  it("rejects SDK-only browser connection settings during Stagehand initialization", () => {
    for (const browser of [
      { type: "local" },
      { type: "cdp", cdpUrl: "wss://browser.example/devtools/browser/session" },
    ]) {
      expect(() => StagehandMethods.stagehandInit.params.parse({ browser })).toThrow();
    }
  });

  it("rejects model names without a provider prefix", () => {
    expect(() =>
      StagehandMethods.stagehandInit.params.parse({
        model: { modelName: "gpt-5-mini" },
      }),
    ).toThrow();
  });

  it("requires a per-call model override to be a complete model configuration", () => {
    expect(
      StagehandMethods.stagehandAct.params.parse({
        input: "Click the submit button",
        options: {
          model: {
            modelName: "anthropic/claude-sonnet-4-6",
            apiKey: "test-key",
          },
        },
      }),
    ).toMatchObject({
      options: {
        model: {
          modelName: "anthropic/claude-sonnet-4-6",
          apiKey: "test-key",
        },
      },
    });

    expect(() =>
      StagehandMethods.stagehandAct.params.parse({
        input: "Click the submit button",
        options: { model: { apiKey: "test-key" } },
      }),
    ).toThrow();
  });

  it("defines extraction with a page, instruction, JSON Schema, and optional call settings", () => {
    const params = StagehandMethods.stagehandExtract.params.parse({
      pageId: "target-1",
      instruction: "Extract the page heading",
      schema: {
        type: "object",
        properties: { heading: { type: "string" } },
        required: ["heading"],
        additionalProperties: false,
      },
      options: {
        selector: "main",
        model: {
          modelName: "anthropic/claude-sonnet-4-6",
          apiKey: "test-key",
        },
      },
    });

    expect(params).toMatchObject({
      pageId: "target-1",
      instruction: "Extract the page heading",
      schema: {
        type: "object",
        properties: { heading: { type: "string" } },
      },
      options: {
        selector: "main",
        model: {
          modelName: "anthropic/claude-sonnet-4-6",
          apiKey: "test-key",
        },
      },
    });
  });

  it("rejects extraction without a page, instruction, or schema", () => {
    expect(() =>
      StagehandMethods.stagehandExtract.params.parse({
        instruction: "Extract the page heading",
        schema: { type: "object" },
      }),
    ).toThrow();
    expect(() =>
      StagehandMethods.stagehandExtract.params.parse({
        pageId: "target-1",
        schema: { type: "object" },
      }),
    ).toThrow();
    expect(() =>
      StagehandMethods.stagehandExtract.params.parse({
        pageId: "target-1",
        instruction: "Extract the page heading",
      }),
    ).toThrow();
  });

  it("defines observation with an explicit page and optional instruction", () => {
    expect(
      StagehandMethods.stagehandObserve.params.parse({
        pageId: "target-1",
        instruction: "Find the submit button",
        options: {
          selector: "main",
          locator: { css: "main" },
          variables: {
            accountEmail: {
              value: "user@example.com",
              description: "The account email",
            },
          },
        },
      }),
    ).toStrictEqual({
      pageId: "target-1",
      instruction: "Find the submit button",
      options: {
        selector: "main",
        locator: { css: "main" },
        variables: {
          accountEmail: {
            value: "user@example.com",
            description: "The account email",
          },
        },
      },
    });
    expect(StagehandMethods.stagehandObserve.params.parse({ pageId: "target-1" })).toStrictEqual({
      pageId: "target-1",
    });
  });

  it("rejects observation without a page identity", () => {
    expect(() =>
      StagehandMethods.stagehandObserve.params.parse({
        instruction: "Find the submit button",
      }),
    ).toThrow();
  });

  it("requires page ids for page methods", () => {
    expect(() =>
      StagehandMethods.pageGoto.params.parse({
        url: "https://example.com",
        wait_until: "load",
      }),
    ).toThrow();

    expect(
      StagehandMethods.pageGoto.params.parse({
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

  it("registers context methods", () => {
    expect(
      Object.values(StagehandMethods)
        .map((method) => method.name)
        .filter((name) => name.startsWith("context.")),
    ).toStrictEqual([
      "context.pages",
      "context.new_page",
      "context.active_page",
      "context.set_active_page",
      "context.close",
      "context.add_init_script",
      "context.set_extra_http_headers",
      "context.get_domain_policy",
      "context.set_domain_policy",
      "context.cookies",
      "context.add_cookies",
      "context.clear_cookies",
      "context.clipboard_read_text",
      "context.clipboard_write_text",
      "context.clipboard_clear",
      "context.clipboard_paste",
      "context.clipboard_copy",
      "context.clipboard_cut",
    ]);
  });

  it("registers page methods", () => {
    expect(
      Object.values(StagehandMethods)
        .map((method) => method.name)
        .filter((name) => name.startsWith("page.")),
    ).toStrictEqual([
      "page.goto",
      "page.url",
      "page.title",
      "page.close",
      "page.reload",
      "page.go_back",
      "page.go_forward",
      "page.click",
      "page.hover",
      "page.scroll",
      "page.drag_and_drop",
      "page.type",
      "page.key_press",
      "page.evaluate",
      "page.add_init_script",
      "page.set_extra_http_headers",
      "page.screenshot",
      "page.snapshot",
      "page.set_viewport_size",
      "page.wait_for_load_state",
      "page.wait_for_timeout",
      "page.wait_for_selector",
    ]);
  });

  it("keeps locators as page-scoped descriptors", () => {
    expect(
      StagehandMethods.locatorTextContent.params.parse({
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
      StagehandMethods.locatorTextContent.params.parse({
        pageId: "target-1",
        selector: "h1",
        nth: -1,
      }),
    ).toThrow();
  });

  it("defines locator parity method parameter and result schemas", () => {
    expect(StagehandMethods.locatorHover.params.parse(locatorDescriptor())).toStrictEqual(
      locatorDescriptor(),
    );
    expect(StagehandMethods.locatorHover.result.parse({ hovered: true })).toStrictEqual({
      hovered: true,
    });

    expect(StagehandMethods.locatorCount.result.parse({ count: 2 })).toStrictEqual({
      count: 2,
    });
    expect(() => StagehandMethods.locatorCount.result.parse({ count: -1 })).toThrow();

    expect(StagehandMethods.locatorIsChecked.result.parse({ checked: true })).toStrictEqual({
      checked: true,
    });
    expect(
      StagehandMethods.locatorInputValue.result.parse({ value: "user@example.com" }),
    ).toStrictEqual({ value: "user@example.com" });
    expect(StagehandMethods.locatorInnerText.result.parse({ text: "Submit" })).toStrictEqual({
      text: "Submit",
    });
    expect(StagehandMethods.locatorInnerHtml.result.parse({ html: "<b>Submit</b>" })).toStrictEqual(
      {
        html: "<b>Submit</b>",
      },
    );

    expect(
      StagehandMethods.locatorScrollTo.params.parse({
        ...locatorDescriptor(),
        percent: "bottom",
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      percent: "bottom",
    });
    expect(StagehandMethods.locatorCentroid.result.parse({ x: 12.5, y: 44 })).toStrictEqual({
      x: 12.5,
      y: 44,
    });

    expect(
      StagehandMethods.locatorHighlight.params.parse({
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
      StagehandMethods.locatorSendClickEvent.params.parse({
        ...locatorDescriptor(),
        options: { bubbles: true, cancelable: true, composed: true, detail: 2 },
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      options: { bubbles: true, cancelable: true, composed: true, detail: 2 },
    });

    expect(
      StagehandMethods.locatorType.params.parse({
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
      StagehandMethods.locatorSelectOption.params.parse({
        ...locatorDescriptor(),
        values: ["a", "b"],
      }),
    ).toStrictEqual({
      ...locatorDescriptor(),
      values: ["a", "b"],
    });
    expect(StagehandMethods.locatorSelectOption.result.parse({ values: ["a"] })).toStrictEqual({
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
      StagehandMethods.runtimeConfigure.params.parse({
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
