import { describe, expect, it } from "vite-plus/test";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";

describe("Stagehand loopback protocol", () => {
  it("defines runtime.configure as a JSON-RPC method", () => {
    const params = StagehandMethods.runtimeConfigure.params.parse({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });

    expect(params).toStrictEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });

    expect(
      StagehandMethods.runtimeConfigure.result.parse({
        configured: true,
      }),
    ).toStrictEqual({
      configured: true,
    });
  });

  it("rejects runtime.configure without a CDP URL", () => {
    expect(() => StagehandMethods.runtimeConfigure.params.parse({})).toThrow();
  });

  it("defines runtime.loopback_status as a JSON-RPC method", () => {
    expect(StagehandMethods.runtimeLoopbackStatus.params.parse({})).toStrictEqual({});
    expect(
      StagehandMethods.runtimeLoopbackStatus.result.parse({
        configured: true,
        connected: false,
      }),
    ).toStrictEqual({
      configured: true,
      connected: false,
    });
  });

  it("defines browser.get_version as a JSON-RPC method", () => {
    expect(StagehandMethods.browserGetVersion.params.parse({})).toStrictEqual({});
    expect(
      StagehandMethods.browserGetVersion.result.parse({
        protocolVersion: "1.3",
        product: "Chrome/143.0.0.0",
        revision: "@abc123",
        userAgent: "Mozilla/5.0",
        jsVersion: "14.3",
      }),
    ).toStrictEqual({
      protocolVersion: "1.3",
      product: "Chrome/143.0.0.0",
      revision: "@abc123",
      userAgent: "Mozilla/5.0",
      jsVersion: "14.3",
    });
  });

  it("exports loopback methods through the JSON-RPC request schema", () => {
    expect(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.configure",
        params: {
          cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        },
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        telemetry: {
          traces: {
            endpoint: "https://example.com/v1/traces",
            headers: {},
          },
        },
      },
    });

    expect(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 2,
        method: "browser.get_version",
        params: {},
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "browser.get_version",
      params: {},
    });
  });
});
