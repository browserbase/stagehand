import { describe, expect, it, vi } from "vitest";
import type { StagehandBrowserSession } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";

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

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
      logLevel: "info",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });
    await runtime.initialize({
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

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
      logLevel: "info",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    await expect(
      runtime.initialize({
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
      logLevel: "info",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });
    await runtime.initialize({
      model: { modelName: "openai/gpt-5", apiKey: "secret" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    await runtime.close();

    expect(runtime.state.getState()).toStrictEqual({ status: "closed" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not let an older close overwrite a replacement browser session", async () => {
    let finishClose: (() => void) | undefined;
    const closeStarted = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const oldClose = vi.fn(async () => await closeStarted);
    const replacementSession = createBrowserSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async (cdpUrl) =>
        cdpUrl.endsWith("replacement")
          ? replacementSession
          : createBrowserSession({ close: oldClose }),
    });

    await runtime.configureLoopback({ cdpUrl: "ws://browser.example" });
    await runtime.initialize({
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });
    const closing = runtime.close();
    await vi.waitFor(() => expect(oldClose).toHaveBeenCalledOnce());

    await runtime.configureLoopback({ cdpUrl: "ws://browser.replacement" });
    finishClose?.();
    await closing;

    expect(runtime.browserSession).toBe(replacementSession);
    expect(runtime.state.getState().status).toBe("initialized");
  });
});
