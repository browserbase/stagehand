import { describe, expect, it } from "vite-plus/test";
import { StagehandInitParamsSchema } from "../../protocol/schemas.js";
import { StagehandClientInitParamsSchema } from "../src/clientSchemas.js";

const defaultTelemetry = {
  traces: {
    endpoint: "https://example.com/v1/traces",
    headers: {},
  },
};

describe("Stagehand client browser sources", () => {
  it("uses Browserbase by default when an API key is provided", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: { type: "browserbase" },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts flattened Browserbase session creation settings", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
        browser: {
          type: "browserbase",
          keepAlive: true,
          region: "eu-central-1",
          userMetadata: { suite: "smoke" },
        },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        keepAlive: true,
        region: "eu-central-1",
        userMetadata: { suite: "smoke" },
      },
      telemetry: defaultTelemetry,
    });
  });

  it("requires an API key for the default Browserbase source", () => {
    expect(() => StagehandClientInitParamsSchema.parse({})).toThrow();
  });

  it("requires an API key for an explicit Browserbase source", () => {
    expect(() =>
      StagehandClientInitParamsSchema.parse({
        browser: { type: "browserbase" },
      }),
    ).toThrow();
  });

  it("launches a local browser from flattened launch settings", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        browser: {
          type: "local",
          headless: false,
          keepAlive: true,
          userDataDir: "/tmp/stagehand-profile",
        },
      }),
    ).toStrictEqual({
      browser: {
        type: "local",
        headless: false,
        keepAlive: true,
        userDataDir: "/tmp/stagehand-profile",
      },
      telemetry: defaultTelemetry,
    });
  });

  it("connects to an existing browser from flattened CDP settings", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        browser: {
          type: "cdp",
          cdpUrl: "wss://browser.example/devtools/browser/session",
          headers: { Authorization: "Bearer secret" },
        },
      }),
    ).toStrictEqual({
      browser: {
        type: "cdp",
        cdpUrl: "wss://browser.example/devtools/browser/session",
        headers: { Authorization: "Bearer secret" },
      },
      telemetry: defaultTelemetry,
    });
  });

  it("requires a CDP URL for the CDP source", () => {
    expect(() =>
      StagehandClientInitParamsSchema.parse({
        browser: { type: "cdp" },
      }),
    ).toThrow();
  });

  it("accepts a Browserbase API key for worker services with a local source", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
        browser: { type: "local" },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: { type: "local" },
      telemetry: defaultTelemetry,
    });
  });

  it("accepts a Browserbase API key for worker services with a CDP source", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
        browser: {
          type: "cdp",
          cdpUrl: "wss://browser.example/devtools/browser/session",
        },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "cdp",
        cdpUrl: "wss://browser.example/devtools/browser/session",
      },
      telemetry: defaultTelemetry,
    });
  });

  it("rejects fields belonging to a different browser source", () => {
    const mixedSources = [
      {
        apiKey: "bb_key",
        browser: { type: "browserbase", cdpUrl: "wss://browser.example" },
      },
      {
        browser: { type: "local", region: "eu-central-1" },
      },
      {
        browser: {
          type: "cdp",
          cdpUrl: "wss://browser.example",
          headless: true,
        },
      },
    ];

    for (const initParams of mixedSources) {
      expect(() => StagehandClientInitParamsSchema.parse(initParams)).toThrow();
    }
  });

  it("rejects nested browser option wrappers", () => {
    const nestedOptions = [
      {
        apiKey: "bb_key",
        browser: {
          type: "browserbase",
          sessionCreateParams: { region: "eu-central-1" },
        },
      },
      {
        browser: {
          type: "local",
          launchOptions: { headless: true },
        },
      },
    ];

    for (const initParams of nestedOptions) {
      expect(() => StagehandClientInitParamsSchema.parse(initParams)).toThrow();
    }
  });

  it("rejects an unknown browser source type", () => {
    expect(() =>
      StagehandClientInitParamsSchema.parse({
        browser: { type: "remote", cdpUrl: "wss://browser.example" },
      }),
    ).toThrow();
  });

  it("keeps Browserbase credentials and settings in worker initialization", () => {
    const clientInitParams = StagehandClientInitParamsSchema.parse({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
      },
      selfHeal: true,
    });

    expect(StagehandInitParamsSchema.parse(clientInitParams)).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
      },
      telemetry: defaultTelemetry,
      selfHeal: true,
    });
  });

  it("keeps local and CDP browser connection settings out of the worker schema", () => {
    expect(() =>
      StagehandInitParamsSchema.parse({
        browser: { type: "local" },
      }),
    ).toThrow();
    expect(() =>
      StagehandInitParamsSchema.parse({
        browser: {
          type: "cdp",
          cdpUrl: "wss://browser.example/devtools/browser/session",
        },
      }),
    ).toThrow();
  });

  it("rejects removed browser constructor fields", () => {
    const removedFields = [
      "env",
      "localBrowserLaunchOptions",
      "localBrowserConnectOptions",
      "browserbaseSessionCreateParams",
      "browserbaseConnectOptions",
      "projectId",
      "browserbaseSessionID",
    ];

    for (const removedField of removedFields) {
      expect(() =>
        StagehandClientInitParamsSchema.parse({
          apiKey: "bb_key",
          [removedField]: {},
        }),
      ).toThrow();
    }
  });
});
