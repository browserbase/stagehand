import { describe, expect, it } from "vitest";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";

describe("Stagehand loopback protocol", () => {
  it("defines runtime.configure as a JSON-RPC method", () => {
    const params = StagehandMethods.runtimeConfigure.params.parse({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });

    expect(params).toStrictEqual({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      logLevel: "info",
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

  it("exports runtime.configure through the JSON-RPC request schema", () => {
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
        logLevel: "info",
        telemetry: {
          traces: {
            endpoint: "https://example.com/v1/traces",
            headers: {},
          },
        },
      },
    });
  });

  it.each(["ping", "runtime.loopback_status", "browser.get_version"])(
    "does not expose the internal diagnostic method %s",
    (method) => {
      expect(
        StagehandRpcRequestSchema.safeParse({
          jsonrpc: "2.0",
          id: 2,
          method,
          params: {},
        }).success,
      ).toBe(false);
    },
  );
});
