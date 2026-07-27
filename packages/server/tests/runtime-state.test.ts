import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type { StagehandBrowserSession } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";

const clientMetadata = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
  logLevel: "info" as const,
};

function createBrowserSession(
  overrides: Partial<StagehandBrowserSession> = {},
): StagehandBrowserSession {
  return {
    connected: true,
    getVersion: async () => ({}),
    pages: () => [],
    newPage: async () => {
      throw new Error("Not used by this test");
    },
    activePage: async () => undefined,
    setActivePage: async () => {},
    addInitScript: async () => {},
    setExtraHTTPHeaders: async () => {},
    getDomainPolicy: () => null,
    setDomainPolicy: async () => {},
    cookies: async () => [],
    addCookies: async () => {},
    clearCookies: async () => {},
    clipboard: {
      readText: async () => "",
      writeText: async () => {},
      clear: async () => {},
      paste: async () => {},
      copy: async () => {},
      cut: async () => {},
    },
    close: async () => {},
    ...overrides,
  };
}

describe("Stagehand runtime state", () => {
  it("stores the exact validated Stagehand init params after initialization", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession(),
    });
    const configureTracing = vi.spyOn(runtime.tracing, "configure").mockImplementation(() => {});

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...clientMetadata,
      model: { modelName: "openai/gpt-5" },
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
      selfHeal: true,
    });

    expect(runtime.state.getState()).toStrictEqual({
      status: "initialized",
      initParams: {
        ...clientMetadata,
        model: { modelName: "openai/gpt-5" },
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
        selfHeal: true,
      },
    });
    expect(configureTracing).toHaveBeenCalledOnce();
    expect(configureTracing).toHaveBeenCalledWith({
      traces: {
        endpoint: "https://collector.example.com/v1/traces",
        headers: { Authorization: "Bearer test" },
      },
    });
  });

  it("leaves server state unchanged when initialization fails", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () =>
        createBrowserSession({
          pages: () => {
            throw new Error("Could not read pages");
          },
        }),
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });

    await expect(
      runtime.initialize({
        ...clientMetadata,
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      }),
    ).rejects.toThrow("Could not read pages");
    expect(runtime.state.getState()).toStrictEqual({ status: "created" });
  });

  it("clears initialized configuration when Stagehand closes", async () => {
    const close = vi.fn();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession({ close }),
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...clientMetadata,
      model: { modelName: "openai/gpt-5", apiKey: "secret" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    await runtime.close();

    expect(runtime.state.getState()).toStrictEqual({ status: "closed" });
    expect(close).toHaveBeenCalledOnce();
  });
});
