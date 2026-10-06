import { describe, expect, expectTypeOf, it } from "vitest";
import type Browserbase from "@browserbasehq/sdk";
import type { ClientOptions } from "@browserbasehq/sdk";
import {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseLaunchOptionsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
} from "../../src/clientSchemas.js";
import type {
  BrowserbaseBrowser,
  BrowserbaseClientOptions,
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowser,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
  StagehandBrowser,
  StagehandBrowserOrigin,
  StagehandBrowserProvider,
} from "../../src/browser/index.js";
import type { BrowserContext } from "../../src/browserContext.js";

describe("browser API contracts", () => {
  it("defines nominal, provider-independent browser handles", () => {
    expectTypeOf<StagehandBrowser["provider"]>().toEqualTypeOf<StagehandBrowserProvider>();
    expectTypeOf<StagehandBrowserProvider>().toEqualTypeOf<"local" | "browserbase">();
    expectTypeOf<StagehandBrowser["origin"]>().toEqualTypeOf<StagehandBrowserOrigin>();
    expectTypeOf<StagehandBrowserOrigin>().toEqualTypeOf<"launched" | "connected">();
    expectTypeOf<StagehandBrowser["context"]>().toEqualTypeOf<BrowserContext>();
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
      Omit<BrowserbaseLaunchOptions, "apiKey" | "baseUrl" | "clientOptions">
    >().toEqualTypeOf<Browserbase.SessionCreateParams>();
    expectTypeOf<BrowserbaseLaunchOptions["clientOptions"]>().toEqualTypeOf<
      BrowserbaseClientOptions | undefined
    >();
    expectTypeOf<BrowserbaseClientOptions>().toEqualTypeOf<
      Pick<ClientOptions, "timeout" | "maxRetries" | "defaultHeaders" | "defaultQuery" | "fetch">
    >();
    expectTypeOf<Parameters<BrowserbaseBrowser["connect"]>>().toEqualTypeOf<
      [options: BrowserbaseConnectOptions]
    >();
    expectTypeOf<BrowserbaseConnectOptions>().toExtend<{
      apiKey: string;
      baseUrl?: string;
      sessionId: string;
      extensionId?: string;
    }>();
    expectTypeOf<BrowserbaseConnectOptions["clientOptions"]>().toEqualTypeOf<
      BrowserbaseClientOptions | undefined
    >();
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
      baseUrl: "https://api.browserbase.com",
    });
    expect(
      BrowserbaseLaunchOptionsSchema.parse({
        apiKey: "bb_key",
        projectId: "project_123",
        proxySettings: { caCertificates: ["certificate_123"] },
        extensionId: "user-extension",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      baseUrl: "https://api.browserbase.com",
      projectId: "project_123",
      proxySettings: { caCertificates: ["certificate_123"] },
      extensionId: "user-extension",
    });
    expect(
      BrowserbaseLaunchOptionsSchema.parse({
        apiKey: "bb_key",
        browserSettings: { extensionId: "user-extension" },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      baseUrl: "https://api.browserbase.com",
      browserSettings: { extensionId: "user-extension" },
    });
    expect(() =>
      BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key", type: "browserbase" }),
    ).toThrow();
    expect(() =>
      BrowserbaseLaunchOptionsSchema.parse({
        apiKey: "bb_key",
        apiUrl: "https://api.dev.browserbase.com",
      }),
    ).toThrow();
    expect(
      BrowserbaseConnectOptionsSchema.parse({
        apiKey: "bb_key",
        sessionId: "session_123",
        extensionId: "user-extension",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      baseUrl: "https://api.browserbase.com",
      sessionId: "session_123",
      extensionId: "user-extension",
    });
    const fetch = async () => new Response();
    expect(
      BrowserbaseConnectOptionsSchema.parse({
        apiKey: "bb_key",
        sessionId: "session_123",
        clientOptions: {
          timeout: 5_000,
          maxRetries: 1,
          defaultHeaders: { "X-Caller": "app" },
          fetch,
        },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      baseUrl: "https://api.browserbase.com",
      sessionId: "session_123",
      clientOptions: {
        timeout: 5_000,
        maxRetries: 1,
        defaultHeaders: { "X-Caller": "app" },
        fetch,
      },
    });
    for (const clientOptions of [
      { apiKey: "other_key" },
      { baseURL: "https://api.dev.browserbase.com" },
      { timeout: -1 },
      { maxRetries: 1.5 },
      { fetch: "not-a-function" },
    ]) {
      expect(() =>
        BrowserbaseLaunchOptionsSchema.parse({ apiKey: "bb_key", clientOptions }),
      ).toThrow();
      expect(() =>
        BrowserbaseConnectOptionsSchema.parse({
          apiKey: "bb_key",
          sessionId: "session_123",
          clientOptions,
        }),
      ).toThrow();
    }
    expect(() =>
      LocalBrowserConnectOptionsSchema.parse({
        cdpUrl: "ws://127.0.0.1:9222",
        unexpected: true,
      }),
    ).toThrow();
  });
});
