import { describe, expect, it } from "vitest";
import { StagehandInitParamsSchema } from "../../protocol/schemas.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientInitParamsSchema,
  StagehandClientObserveOptionsSchema,
} from "../src/clientSchemas.js";
import { Page } from "../src/page.js";
import type { RPCClient } from "../src/rpcClient.js";

const defaultTelemetry = {
  traces: {
    endpoint: "https://example.com/v1/traces",
    headers: {},
  },
};
const defaultLogging = {
  level: "info",
  format: "pretty",
};

describe("Stagehand client method options", () => {
  it("extends protocol method options with SDK Page instances", () => {
    const page = new Page({} as RPCClient, { pageId: "page-1" });

    for (const schema of [
      StagehandClientActOptionsSchema,
      StagehandClientObserveOptionsSchema,
      StagehandClientExtractOptionsSchema,
    ]) {
      expect(schema.parse({ page, timeout: 5_000 })).toStrictEqual({ page, timeout: 5_000 });
      expect(() => schema.parse({ page: { pageId: "page-1" } })).toThrow();
    }
  });
});

describe("Stagehand client browser sources", () => {
  it("uses Browserbase by default when an API key is provided", () => {
    expect(
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: { type: "browserbase" },
      logging: defaultLogging,
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
      logging: defaultLogging,
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

  it("rejects Browserbase extension IDs because the SDK provisions its own extension", () => {
    const browserSources = [
      {
        type: "browserbase",
        extensionId: "ext_caller",
      },
      {
        type: "browserbase",
        browserSettings: { extensionId: "ext_caller" },
      },
    ];

    for (const browser of browserSources) {
      expect(() => StagehandClientInitParamsSchema.parse({ apiKey: "bb_key", browser })).toThrow();
    }
  });

  it("rejects a caller-provided Browserbase session ID", () => {
    expect(() =>
      StagehandClientInitParamsSchema.parse({
        apiKey: "bb_key",
        browser: {
          type: "browserbase",
          sessionId: "session_123",
        },
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
      logging: defaultLogging,
      telemetry: defaultTelemetry,
    });
  });

  it("rejects the removed local browser connect timeout", () => {
    expect(() =>
      StagehandClientInitParamsSchema.parse({
        browser: {
          type: "local",
          connectTimeoutMs: 10_000,
        },
      }),
    ).toThrow();
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
      logging: defaultLogging,
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
      logging: defaultLogging,
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
      logging: defaultLogging,
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

  it("requires the resolved Browserbase session ID in worker initialization", () => {
    const clientInitParams = StagehandClientInitParamsSchema.parse({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
      },
      selfHeal: true,
    });
    const { logging: _logging, ...protocolParams } = clientInitParams;

    expect(() => StagehandInitParamsSchema.parse(clientInitParams)).toThrow();
    expect(
      StagehandInitParamsSchema.parse({
        ...protocolParams,
        browser: {
          ...clientInitParams.browser,
          sessionId: "session_123",
        },
      }),
    ).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        region: "eu-central-1",
        sessionId: "session_123",
      },
      telemetry: defaultTelemetry,
      selfHeal: true,
    });
  });

  it("uses info and pretty terminal logs by default", () => {
    const parsed = StagehandClientInitParamsSchema.parse({
      browser: { type: "local" },
    });

    expect(parsed.logging).toStrictEqual(defaultLogging);
  });

  it("accepts debug JSON logs and a structured onLog callback", () => {
    const onLog = () => {};
    const parsed = StagehandClientInitParamsSchema.parse({
      browser: { type: "local" },
      logging: {
        level: "debug",
        format: "json",
        onLog,
      },
    });

    expect(parsed.logging).toMatchObject({
      level: "debug",
      format: "json",
    });
    expect(parsed.logging.onLog).toBeTypeOf("function");
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
