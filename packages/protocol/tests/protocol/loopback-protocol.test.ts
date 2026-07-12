import { describe, expect, it } from "vite-plus/test";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";

describe("Stagehand loopback protocol", () => {
  it("defines runtime.configure as a JSON-RPC method", () => {
    const params = StagehandMethods["runtime.configure"].paramsSchema.parse({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });

    expect(params).toStrictEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });

    expect(
      StagehandMethods["runtime.configure"].resultSchema.parse({
        configured: true,
      }),
    ).toStrictEqual({
      configured: true,
    });
  });

  it("rejects runtime.configure without a CDP URL", () => {
    expect(() => StagehandMethods["runtime.configure"].paramsSchema.parse({})).toThrow();
  });

  it("defines runtime.loopback_status as a JSON-RPC method", () => {
    expect(StagehandMethods["runtime.loopback_status"].paramsSchema.parse({})).toStrictEqual({});
    expect(
      StagehandMethods["runtime.loopback_status"].resultSchema.parse({
        configured: true,
        connected: false,
      }),
    ).toStrictEqual({
      configured: true,
      connected: false,
    });
  });

  it("defines browser.get_version as a JSON-RPC method", () => {
    expect(StagehandMethods["browser.get_version"].paramsSchema.parse({})).toStrictEqual({});
    expect(
      StagehandMethods["browser.get_version"].resultSchema.parse({
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
