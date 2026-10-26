import { describe, expect, it } from "vitest";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../schemas.js";

describe("Stagehand loopback protocol", () => {
  it("makes stagehand.init the first runtime RPC", () => {
    expect(
      StagehandMethods.stagehandInit.params.parse({
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
        browserCdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      }),
    ).toMatchObject({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
      browserCdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      logLevel: "info",
    });
  });

  it("does not expose runtime.configure", () => {
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
