import { ROOT_CONTEXT } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
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
  it("keeps the persistent browser session on the neutral runtime logger", async () => {
    const browserSessionFactory = vi.fn(async () => createBrowserSession());
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const initLogger = runtime.logger.withContext(ROOT_CONTEXT);

    await runtime.initialize(
      {
        ...runtimeIdentity,
        browserCdpUrl: "ws://browser.example",
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      },
      initLogger,
    );

    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://browser.example",
      runtime.logger,
      initLogger,
    );
  });

  it("replaces a retained browser session when its loopback connection is closed", async () => {
    const closeDisconnectedSession = vi.fn();
    const connectedSession = createBrowserSession();
    const browserSessionFactory = vi.fn(async () => connectedSession);
    const runtime = createStagehandRuntime({ browserSessionFactory });
    runtime.browserSession = createBrowserSession({
      connected: false,
      close: closeDisconnectedSession,
    });

    await expect(
      runtime.initialize({
        ...runtimeIdentity,
        browserCdpUrl: "ws://browser.example/reconnected",
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      }),
    ).resolves.toStrictEqual({ initialized: true, pages: [] });

    expect(closeDisconnectedSession).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://browser.example/reconnected",
      runtime.logger,
      runtime.logger,
    );
    expect(runtime.browserSession).toBe(connectedSession);
  });

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

  it("rejects initialization while another Stagehand instance is initialized", async () => {
    const prepareForInitialization = vi.fn();
    const browserSessionFactory = vi.fn(async () =>
      createBrowserSession({ prepareForInitialization }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...runtimeIdentity,
      model: { modelName: "openai/gpt-5" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    const replacementParams: StagehandInitParams = {
      ...runtimeIdentity,
      model: { modelName: "anthropic/claude-sonnet-4-5" },
      systemPrompt: "Replacement caller",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };

    await expect(runtime.initialize(replacementParams)).rejects.toThrow(
      "A Stagehand instance is already initialized",
    );

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(prepareForInitialization).toHaveBeenCalledOnce();
    expect(runtime.state.getState()).toStrictEqual({
      status: "initialized",
      initParams: {
        ...runtimeIdentity,
        model: { modelName: "openai/gpt-5" },
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      },
    });
  });

  it("returns to a neutral state and reuses the browser session after Stagehand disposal", async () => {
    const sessions: StagehandBrowserSession[] = [];
    const close = vi.fn();
    const prepareForInitialization = vi.fn();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => {
        const session = createBrowserSession({ close, prepareForInitialization });
        sessions.push(session);
        return session;
      },
    });

    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };
    await runtime.initialize(params);
    await runtime.disposeStagehandInstance();

    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
    expect(close).not.toHaveBeenCalled();

    await expect(runtime.initialize(params)).resolves.toStrictEqual({
      initialized: true,
      pages: [],
    });
    expect(sessions).toHaveLength(1);
    expect(prepareForInitialization).toHaveBeenCalledTimes(2);
    expect(runtime.state.getState()).toMatchObject({ status: "initialized" });
  });

  it("waits for runtime disposal before initializing the next Stagehand instance", async () => {
    let markCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve;
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const sessions: StagehandBrowserSession[] = [];
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => {
        const session = createBrowserSession({
          close:
            sessions.length === 0
              ? async () => {
                  markCloseStarted();
                  await closeGate;
                }
              : async () => {},
        });
        sessions.push(session);
        return session;
      },
    });
    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };
    await runtime.initialize(params);

    const closing = runtime.close();
    await closeStarted;
    const initializing = runtime.initialize(params);
    await Promise.resolve();

    expect(sessions).toHaveLength(1);

    releaseClose();
    await closing;
    await expect(initializing).resolves.toStrictEqual({ initialized: true, pages: [] });
    expect(sessions).toHaveLength(2);
    expect(runtime.state.getState()).toMatchObject({ status: "initialized" });
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
    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
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

  it("clears initialized configuration without closing the browser session", async () => {
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

    await runtime.disposeStagehandInstance();

    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
    expect(close).not.toHaveBeenCalled();
  });
});
