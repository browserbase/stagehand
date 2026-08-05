import { describe, expect, expectTypeOf, it } from "vitest";
import type Browserbase from "@browserbasehq/sdk";
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
      Omit<BrowserbaseLaunchOptions, "apiKey">
    >().toEqualTypeOf<Browserbase.SessionCreateParams>();
    expectTypeOf<Parameters<BrowserbaseBrowser["connect"]>>().toEqualTypeOf<
      [options: BrowserbaseConnectOptions]
    >();
    expectTypeOf<BrowserbaseConnectOptions>().toExtend<{
      apiKey: string;
      sessionId: string;
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
        projectId: "project_123",
        proxySettings: { caCertificates: ["certificate_123"] },
        extensionId: "user-extension",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
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
});
