import { describe, expect, it } from "vitest";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../schemas.js";

const clientInfo = { name: "stagehand-sdk-test", version: "1.0.0" };
const runtimeIdentity = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo,
};

describe("Stagehand loopback protocol", () => {
  it("defines runtime.configure as a JSON-RPC method", () => {
    const params = StagehandMethods.runtimeConfigure.params.parse({
      ...runtimeIdentity,
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });

    expect(params).toStrictEqual({
      ...runtimeIdentity,
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

  it.each(["protocolVersion", "clientInfo", "cdpUrl"] as const)(
    "rejects runtime.configure without %s",
    (field) => {
      const params: Record<string, unknown> = {
        ...runtimeIdentity,
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      };
      delete params[field];
      expect(() => StagehandMethods.runtimeConfigure.params.parse(params)).toThrow();
    },
  );

  it("exports runtime.configure through the JSON-RPC request schema", () => {
    expect(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.configure",
        params: {
          ...runtimeIdentity,
          cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        },
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        ...runtimeIdentity,
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
