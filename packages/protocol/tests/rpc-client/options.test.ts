import { describe, expect, it } from "vite-plus/test";
import { connectRPCClient, RPCClientOptionsSchema } from "../../../sdk-ts/src/rpcClient.ts";

describe("RPCClientOptionsSchema", () => {
  it("accepts load-unpacked mode with extensionDir", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
      }),
    ).toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: "/tmp/stagehand-extension",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
  });

  it("accepts preloaded extension mode with extensionId", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
      }),
    ).toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
  });

  it("accepts preloaded Stagehand discovery without loading an extension", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        preloadedExtension: true,
      }),
    ).toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
      preloadedExtension: true,
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
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
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

  it("rejects options without an explicit extension load mode", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
      }),
    ).toThrow();
  });

  it("rejects ambiguous options with both extensionDir and extensionId", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
      }),
    ).toThrow();
  });

  it("rejects preloaded discovery combined with another extension mode", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        extensionDir: "/tmp/stagehand-extension",
        preloadedExtension: true,
      }),
    ).toThrow();
  });

  it("rejects unknown rpcClient options", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        rawCdp: true,
      }),
    ).toThrow();
  });

  it("validates options at the RPC client boundary before opening CDP", async () => {
    await expect(
      connectRPCClient({
        cdpUrl: "http://127.0.0.1:1",
      } as never),
    ).rejects.toThrow();
  });
});
