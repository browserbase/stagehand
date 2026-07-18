import { describe, expect, it, vi } from "vite-plus/test";
import { createStagehandRuntime } from "../runtime.js";

describe("Stagehand runtime state", () => {
  it("stores the exact validated Stagehand init params after initialization", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => ({
        connected: true,
        getVersion: async () => ({}),
        pages: () => [],
        newPage: async () => {
          throw new Error("Not used by this test");
        },
        close: async () => {},
      }),
    });

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
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
      browserSessionFactory: async () => ({
        connected: true,
        getVersion: async () => ({}),
        pages: () => {
          throw new Error("Could not read pages");
        },
        newPage: async () => {
          throw new Error("Not used by this test");
        },
        close: async () => {},
      }),
    });

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
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
      browserSessionFactory: async () => ({
        connected: true,
        getVersion: async () => ({}),
        pages: () => [],
        newPage: async () => {
          throw new Error("Not used by this test");
        },
        close,
      }),
    });

    await runtime.configureLoopback({
      cdpUrl: "ws://browser.example",
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
});
