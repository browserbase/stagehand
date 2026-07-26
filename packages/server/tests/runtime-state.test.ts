import { describe, expect, it, vi } from "vitest";
import type { StagehandBrowserSession } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";

const clientMetadata = {
  protocolVersion: 4 as const,
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

    await runtime.configureLoopback({
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

    await runtime.configureLoopback({
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

    await runtime.configureLoopback({
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

  it("returns the runtime to created state for a new reservation", async () => {
    const close = vi.fn(async () => {});
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession({ close }),
    });

    await runtime.configureLoopback({ cdpUrl: "ws://browser.example" });
    await runtime.initialize({
      ...clientMetadata,
      model: { modelName: "openai/gpt-5" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });
    runtime.pagesById.set("previous-page", {} as never);

    await runtime.resetForReservation();

    expect(close).toHaveBeenCalledOnce();
    expect(runtime.pagesById.size).toBe(0);
    expect(runtime.state.getState()).toStrictEqual({ status: "created" });
    expect(runtime.loopbackStatus()).toStrictEqual({ configured: false, connected: false });
  });
});
