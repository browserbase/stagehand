import { describe, expect, expectTypeOf, it } from "vitest";
import type { BrowserbaseSessionCreateParams } from "../../../protocol/types.js";
import {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseLaunchOptionsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
} from "../../src/clientSchemas.js";
import type {
  BrowserbaseBrowser,
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowser,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
  StagehandBrowser,
  StagehandBrowserOrigin,
  StagehandBrowserProvider,
} from "../../src/browser/index.js";

describe("browser API contracts", () => {
  it("defines nominal, provider-independent browser handles", () => {
    expectTypeOf<StagehandBrowser["provider"]>().toEqualTypeOf<StagehandBrowserProvider>();
    expectTypeOf<StagehandBrowserProvider>().toEqualTypeOf<"local" | "browserbase">();
    expectTypeOf<StagehandBrowser["origin"]>().toEqualTypeOf<StagehandBrowserOrigin>();
    expectTypeOf<StagehandBrowserOrigin>().toEqualTypeOf<"launched" | "connected">();
    expectTypeOf<StagehandBrowser["close"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<{
      provider: "local";
      origin: "launched";
      closed: boolean;
      close(): Promise<void>;
    }>().not.toExtend<StagehandBrowser>();
  });

  it("defines local launch and connect separately", () => {
    expectTypeOf<Parameters<LocalBrowser["launch"]>>().toEqualTypeOf<
      [options?: LocalBrowserLaunchOptions]
    >();
    expectTypeOf<ReturnType<LocalBrowser["launch"]>>().toEqualTypeOf<Promise<StagehandBrowser>>();
    expectTypeOf<Parameters<LocalBrowser["connect"]>>().toEqualTypeOf<
      [options: LocalBrowserConnectOptions]
    >();
    expectTypeOf<LocalBrowserConnectOptions>().toExtend<{
      cdpUrl: string;
      connectTimeoutMs?: number;
      extensionId?: string;
    }>();
  });

  it("defines Browserbase launch and connect separately", () => {
    expectTypeOf<Parameters<BrowserbaseBrowser["launch"]>>().toEqualTypeOf<
      [options: BrowserbaseLaunchOptions]
    >();
    expectTypeOf<ReturnType<BrowserbaseBrowser["launch"]>>().toEqualTypeOf<
      Promise<StagehandBrowser>
    >();
    expectTypeOf<
      Omit<BrowserbaseLaunchOptions, "apiKey">
    >().toEqualTypeOf<BrowserbaseSessionCreateParams>();
    expectTypeOf<Parameters<BrowserbaseBrowser["connect"]>>().toEqualTypeOf<
      [options: BrowserbaseConnectOptions]
    >();
    expectTypeOf<BrowserbaseConnectOptions>().toExtend<{
      apiKey: string;
      sessionId: string;
      connectTimeoutMs?: number;
      extensionId?: string;
    }>();
  });

  it("defines every browser input as a strict client-side schema", () => {
    expect(LocalBrowserLaunchOptionsSchema.parse({ headless: true })).toStrictEqual({
      headless: true,
    });
    expect(LocalBrowserConnectOptionsSchema.parse({ cdpUrl: "ws://127.0.0.1:9222" })).toStrictEqual(
      { cdpUrl: "ws://127.0.0.1:9222" },
    );
    expect(BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key" })).toStrictEqual({
      apiKey: "bb_key",
    });
    expect(
      BrowserbaseLaunchOptionsSchema.parse({
        apiKey: "bb_key",
        proxies: [{ type: "browserbase", geolocation: { country: "US" } }],
        region: "us-west-2",
        extensionId: "user-extension",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      proxies: [{ type: "browserbase", geolocation: { country: "US" } }],
      region: "us-west-2",
      extensionId: "user-extension",
    });
    expect(
      BrowserbaseLaunchOptionsSchema.parse({
        apiKey: "bb_key",
        browserSettings: { extensionId: "user-extension" },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browserSettings: { extensionId: "user-extension" },
    });
    expect(() =>
      BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key", type: "browserbase" }),
    ).toThrow();
    expect(
      BrowserbaseConnectOptionsSchema.parse({
        apiKey: "bb_key",
        sessionId: "session_123",
        extensionId: "user-extension",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      sessionId: "session_123",
      extensionId: "user-extension",
    });
    expect(() =>
      LocalBrowserConnectOptionsSchema.parse({
        cdpUrl: "ws://127.0.0.1:9222",
        unexpected: true,
      }),
    ).toThrow();
  });

  it.each([0, 59, 21_601])("rejects an out-of-range Browserbase timeout of %s", (timeout) => {
    expect(() => BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key", timeout })).toThrow();
  });

  it.each([60, 21_600])("accepts a Browserbase timeout boundary of %s", (timeout) => {
    expect(BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key", timeout })).toStrictEqual({
      apiKey: "bb_key",
      timeout,
    });
  });
});
