import { describe, expect, it, vi } from "vite-plus/test";
import type { StagehandBridge, StagehandBridgeOptions } from "../../modcdp/index.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { Stagehand } from "../src/index.js";
import type { ResolvedBrowserSource } from "../src/browserSource.js";
import type {
  StagehandMethod,
  StagehandMethodParams,
  StagehandMethodResult,
} from "../src/protocolClient.js";
import { createStagehandWithDependenciesForTest } from "../src/stagehand.js";

type ProtocolCall<Method extends StagehandMethod = StagehandMethod> = {
  [K in Method]: {
    method: K;
    params: StagehandMethodParams<K>;
  };
}[Method];

class FakeStagehandBridge implements StagehandBridge {
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  readonly calls: ProtocolCall[] = [];
  closed = false;
  #responses = new Map<StagehandMethod, unknown[]>();
  #notificationListeners = new Set<(notification: StagehandRpcNotification) => void>();

  queueResponse<Method extends StagehandMethod>(
    method: Method,
    response: StagehandMethodResult<Method>,
  ): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  async send<Method extends StagehandMethod>(
    method: Method,
    params: StagehandMethodParams<Method>,
  ): Promise<StagehandMethodResult<Method>> {
    this.calls.push({ method, params } as ProtocolCall);
    const responses = this.#responses.get(method);
    if (!responses?.length) {
      throw new Error(`No fake response queued for ${method}`);
    }
    return responses.shift() as StagehandMethodResult<Method>;
  }

  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  emitNotification(notification: StagehandRpcNotification): void {
    for (const listener of this.#notificationListeners) listener(notification);
  }

  get notificationListenerCount(): number {
    return this.#notificationListeners.size;
  }

  close(): void {
    this.closed = true;
  }
}

describe("Stagehand", () => {
  it("throws a clear error when context is used before init", () => {
    const stagehand = new Stagehand({
      localBrowserConnectOptions: {
        cdpUrl: "http://127.0.0.1:9222",
      },
    });

    expect(() => stagehand.context).toThrow("Call stagehand.init() before using context");
  });

  it("initializes through browser source resolution and bridge connection", async () => {
    const bridge = new FakeStagehandBridge();
    bridge.queueResponse("context.pages", [{ pageId: "page-1", url: "about:blank" }]);
    const resolveBrowserSource = vi.fn(async (): Promise<ResolvedBrowserSource> => {
      return {
        cdpUrl: "http://127.0.0.1:9222",
        keepAlive: true,
      };
    });
    const connectBridge = vi.fn(async () => bridge);

    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9222",
        },
      },
      {
        resolveBrowserSource,
        connectBridge,
      },
    );

    await stagehand.init();
    const pages = await stagehand.context.pages();

    expect(stagehand.initialized).toBe(true);
    expect(resolveBrowserSource).toHaveBeenCalledWith({
      localBrowserConnectOptions: {
        cdpUrl: "http://127.0.0.1:9222",
      },
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
    expect(connectBridge).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: expect.stringContaining("packages/extension/dist") as string,
      serviceWorkerUrlIncludes: "service-worker.js",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    } satisfies StagehandBridgeOptions);
    expect(pages[0]?.pageId).toBe("page-1");
    expect(bridge.calls).toStrictEqual([{ method: "context.pages", params: {} }]);
  });

  it("passes the configured OTLP traces destination to the worker bridge", async () => {
    const bridge = new FakeStagehandBridge();
    const connectBridge = vi.fn(async () => bridge);
    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9222",
        },
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
        }),
        connectBridge,
      },
    );

    await stagehand.init();

    expect(connectBridge).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: expect.stringContaining("packages/extension/dist") as string,
      serviceWorkerUrlIncludes: "service-worker.js",
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
    } satisfies StagehandBridgeOptions);
  });

  it("closes the runtime, bridge, and owned browser source", async () => {
    const closeBrowser = vi.fn();
    const bridge = new FakeStagehandBridge();
    bridge.queueResponse("stagehand.close", { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserLaunchOptions: {},
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: false,
          close: closeBrowser,
        }),
        connectBridge: async () => bridge,
      },
    );

    await stagehand.init();
    await stagehand.close();

    expect(stagehand.initialized).toBe(false);
    expect(bridge.calls).toStrictEqual([{ method: "stagehand.close", params: {} }]);
    expect(bridge.closed).toBe(true);
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(() => stagehand.context).toThrow("Call stagehand.init() before using context");
  });

  it("renders streamed Stagehand logs and removes the listener when Stagehand closes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const bridge = new FakeStagehandBridge();
    bridge.queueResponse("stagehand.close", { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9222",
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
        }),
        connectBridge: async () => bridge,
      },
    );

    await stagehand.init();
    bridge.emitNotification({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "info",
        message: "Page opened",
        data: { pageId: "page-1" },
      },
    });

    expect(info).toHaveBeenCalledWith("Page opened", { pageId: "page-1" });
    expect(bridge.notificationListenerCount).toBe(1);

    await stagehand.close();

    expect(bridge.notificationListenerCount).toBe(0);
    info.mockRestore();
  });

  it("does not close a keepAlive browser source", async () => {
    const closeBrowser = vi.fn();
    const bridge = new FakeStagehandBridge();
    bridge.queueResponse("stagehand.close", { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserLaunchOptions: {
          keepAlive: true,
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
          close: closeBrowser,
        }),
        connectBridge: async () => bridge,
      },
    );

    await stagehand.init();
    await stagehand.close();

    expect(bridge.closed).toBe(true);
    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it("cleans up an owned browser source when bridge connection fails", async () => {
    const closeBrowser = vi.fn();
    const stagehand = createStagehandWithDependenciesForTest(
      {
        localBrowserLaunchOptions: {},
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: false,
          close: closeBrowser,
        }),
        connectBridge: async () => {
          throw new Error("bridge failed");
        },
      },
    );

    await expect(stagehand.init()).rejects.toThrow("bridge failed");
    expect(stagehand.initialized).toBe(false);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });
});
