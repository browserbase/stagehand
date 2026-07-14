import { describe, expect, it } from "vite-plus/test";
import { BrowserbaseConnectOptionsSchema, StagehandOptionsSchema } from "../../pending-schemas.js";

const defaultTelemetry = {
  traces: {
    endpoint: "https://example.com/v1/traces",
    headers: {},
  },
};

describe("Stagehand constructor options", () => {
  it("accepts local browser launch options", () => {
    expect(
      StagehandOptionsSchema.parse({
        localBrowserLaunchOptions: {
          headless: false,
          keepAlive: true,
        },
      }),
    ).toStrictEqual({
      localBrowserLaunchOptions: {
        headless: false,
        keepAlive: true,
      },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts local browser connect options", () => {
    expect(
      StagehandOptionsSchema.parse({
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
        },
      }),
    ).toStrictEqual({
      localBrowserConnectOptions: {
        cdpUrl: "http://127.0.0.1:9222",
        keepAlive: true,
      },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts Browserbase session create params", () => {
    expect(
      StagehandOptionsSchema.parse({
        browserbaseSessionCreateParams: {
          apiKey: "bb_key",
          keepAlive: true,
          region: "us-west-2",
          userMetadata: {
            suite: "smoke",
          },
        },
      }),
    ).toStrictEqual({
      browserbaseSessionCreateParams: {
        apiKey: "bb_key",
        keepAlive: true,
        region: "us-west-2",
        userMetadata: {
          suite: "smoke",
        },
      },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts Browserbase connect options with a CDP URL", () => {
    expect(
      StagehandOptionsSchema.parse({
        browserbaseConnectOptions: {
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
          apiKey: "bb_key",
          keepAlive: true,
        },
      }),
    ).toStrictEqual({
      browserbaseConnectOptions: {
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        apiKey: "bb_key",
        keepAlive: true,
      },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts Browserbase connect options with a session ID", () => {
    expect(
      StagehandOptionsSchema.parse({
        browserbaseConnectOptions: {
          sessionId: "session_123",
          apiKey: "bb_key",
        },
      }),
    ).toStrictEqual({
      browserbaseConnectOptions: {
        sessionId: "session_123",
        apiKey: "bb_key",
      },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts top-level selfHeal with one browser source", () => {
    expect(
      StagehandOptionsSchema.parse({
        localBrowserLaunchOptions: {},
        selfHeal: true,
      }),
    ).toStrictEqual({
      localBrowserLaunchOptions: {},
      telemetry: defaultTelemetry,
      selfHeal: true,
    });
  });

  it("rejects zero browser source options", () => {
    expect(() => StagehandOptionsSchema.parse({})).toThrow("Provide exactly one browser source");
  });

  it("rejects multiple browser source options", () => {
    expect(() =>
      StagehandOptionsSchema.parse({
        localBrowserLaunchOptions: {},
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9222",
        },
      }),
    ).toThrow("Provide exactly one browser source");
  });

  it("rejects Browserbase connect options with both CDP URL and session ID", () => {
    expect(() =>
      BrowserbaseConnectOptionsSchema.parse({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
        sessionId: "session_123",
      }),
    ).toThrow("Provide exactly one of cdpUrl or sessionId");
  });

  it("rejects Browserbase connect options with neither CDP URL nor session ID", () => {
    expect(() => BrowserbaseConnectOptionsSchema.parse({})).toThrow(
      "Provide exactly one of cdpUrl or sessionId",
    );
  });

  it("rejects unknown top-level fields", () => {
    expect(() =>
      StagehandOptionsSchema.parse({
        localBrowserLaunchOptions: {},
        unknown: true,
      }),
    ).toThrow();
  });

  it("rejects removed V3 constructor fields", () => {
    for (const removedField of ["env", "model", "projectId", "browserbaseSessionID"]) {
      expect(() =>
        StagehandOptionsSchema.parse({
          localBrowserLaunchOptions: {},
          [removedField]: "removed",
        }),
      ).toThrow();
    }
  });

  it("rejects CDP URL inside local browser launch options", () => {
    expect(() =>
      StagehandOptionsSchema.parse({
        localBrowserLaunchOptions: {
          cdpUrl: "http://127.0.0.1:9222",
        },
      }),
    ).toThrow();
  });
});
