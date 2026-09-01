import { describe, expect, it } from "vitest";
import { connectRPCClient, RPCClientOptionsSchema } from "../src/rpcClient.js";

describe("RPCClientOptionsSchema", () => {
  const signal = new AbortController().signal;

  it("accepts load-unpacked mode with extensionDir", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        signal,
      }),
    ).toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: "/tmp/stagehand-extension",
      signal,
    });
  });

  it("accepts preloaded extension mode with extensionId", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        signal,
      }),
    ).toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      signal,
    });
  });

  it("accepts preloaded Stagehand discovery without loading an extension", () => {
    expect(
      RPCClientOptionsSchema.parse({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        preloadedExtension: true,
        signal,
      }),
    ).toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
      preloadedExtension: true,
      signal,
    });
  });

  it("requires an initialization lifecycle signal", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
      }),
    ).toThrow();
  });

  it("rejects telemetry because it belongs to stagehand.init", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        signal,
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects options without an explicit extension load mode", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        signal,
      }),
    ).toThrow();
  });

  it("rejects ambiguous options with both extensionDir and extensionId", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        signal,
      }),
    ).toThrow();
  });

  it("rejects preloaded discovery combined with another extension mode", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        extensionDir: "/tmp/stagehand-extension",
        preloadedExtension: true,
        signal,
      }),
    ).toThrow();
  });

  it("rejects unknown rpcClient options", () => {
    expect(() =>
      RPCClientOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        signal,
        rawCdp: true,
      }),
    ).toThrow();
  });

  it("validates options at the RPC client boundary before opening CDP", async () => {
    await expect(
      connectRPCClient({
        cdpUrl: "http://127.0.0.1:1",
        signal,
      } as never),
    ).rejects.toThrow();
  });
});
