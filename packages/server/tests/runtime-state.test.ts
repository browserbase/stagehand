import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type { StagehandBrowserSession } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";

const runtimeIdentity = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
  logLevel: "info" as const,
};

function createBrowserSession(
  overrides: Partial<StagehandBrowserSession> = {},
): StagehandBrowserSession {
  return {
    connected: true,
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

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...runtimeIdentity,
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
        ...runtimeIdentity,
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
        ...runtimeIdentity,
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      }),
    ).rejects.toThrow("Could not read pages");
    expect(runtime.state.getState()).toStrictEqual({ status: "created" });
  });

  it("rejects concurrent initialization before creating another browser session", async () => {
    let releaseInitialization!: () => void;
    const initializationGate = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    const browserSessionFactory = vi.fn(async () =>
      createBrowserSession({ prepareForInitialization: async () => await initializationGate }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };

    const firstInitialization = runtime.initialize(params);
    await expect(runtime.initialize(params)).rejects.toThrow(
      "Stagehand initialization is already in progress",
    );
    expect(browserSessionFactory).toHaveBeenCalledOnce();

    releaseInitialization();
    await expect(firstInitialization).resolves.toMatchObject({ initialized: true });
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
      ...runtimeIdentity,
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
