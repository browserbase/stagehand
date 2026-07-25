import { describe, expect, it } from "vitest";
import { connectRPCClient, RPCClientOptionsSchema } from "../../../sdk-ts/src/rpcClient.ts";

describe("RPCClientOptionsSchema", () => {
  it("accepts a CDP URL and assumes the Stagehand extension is already loaded", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
      }),
    ).toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      logLevel: "info",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
  });

  it("accepts a custom OTLP traces destination", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
      }),
    ).toMatchObject({
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
    });
  });

  it("rejects unknown rpcClient options", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        rawCdp: true,
      }),
    ).toThrow();
  });

  it("validates options at the RPC client boundary before opening CDP", async () => {
    await expect(
      connectRPCClient({
        cdpUrl: "",
      } as never),
    ).rejects.toThrow();
  });
});
