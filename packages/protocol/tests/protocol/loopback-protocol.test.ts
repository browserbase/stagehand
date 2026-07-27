import { describe, expect, it } from "vitest";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";

describe("Stagehand loopback protocol", () => {
  it("does not expose a separate runtime.configure method", () => {
    expect(Object.values(StagehandMethods).map((method) => method.name)).not.toContain(
      "runtime.configure",
    );
    expect(() =>
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.configure",
        params: {},
      }),
    ).toThrow();
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
        method: "browser.get_version",
        params: {},
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "browser.get_version",
      params: {},
    });
  });
});
