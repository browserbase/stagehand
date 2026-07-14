import { describe, expect, it } from "vite-plus/test";
import { connectStagehandBridge, StagehandBridgeOptionsSchema } from "../../../modcdp/index.ts";

describe("StagehandBridgeOptionsSchema", () => {
  it("accepts load-unpacked mode with extensionDir", () => {
    expect(
      StagehandBridgeOptionsSchema.parse({
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
      StagehandBridgeOptionsSchema.parse({
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

  it("accepts a custom OTLP traces destination", () => {
    expect(
      StagehandBridgeOptionsSchema.parse({
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
      StagehandBridgeOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
      }),
    ).toThrow();
  });

  it("rejects ambiguous options with both extensionDir and extensionId", () => {
    expect(() =>
      StagehandBridgeOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
      }),
    ).toThrow();
  });

  it("rejects unknown bridge options", () => {
    expect(() =>
      StagehandBridgeOptionsSchema.parse({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: "/tmp/stagehand-extension",
        rawCdp: true,
      }),
    ).toThrow();
  });

  it("validates options at the bridge boundary before opening CDP", async () => {
    await expect(
      connectStagehandBridge({
        cdpUrl: "http://127.0.0.1:1",
      } as never),
    ).rejects.toThrow();
  });
});
