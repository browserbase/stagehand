import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod/v4";
import type { RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { Stagehand } from "../src/index.js";
import type { ResolvedBrowserSource } from "../src/browserSource.js";
import { RPCClient, type RPCClientOptions } from "../src/rpcClient.js";
import { createStagehandWithDependenciesForTest } from "../src/stagehand.js";

type ProtocolCall = { method: string; params: unknown };

class FakeRPCClient extends RPCClient {
  readonly calls: ProtocolCall[] = [];
  closed = false;
  responses = new Map<string, unknown[]>();
  notificationListeners = new Set<(notification: StagehandRpcNotification) => void>();

  constructor() {
    super(
      {
        serviceWorker: {
          targetId: "worker-target",
          url: "chrome-extension://stagehand/service-worker.js",
          title: "Stagehand",
          extensionId: "stagehand",
        },
        send: async () => {},
        close: () => {},
      },
      1_000,
    );
    this.queueResponse(StagehandMethods.stagehandInit, { initialized: true, pages: [] });
  }

  queueResponse<Method extends RPCMethod>(
    method: Method,
    response: z.input<Method["result"]>,
  ): void {
    const responses = this.responses.get(method.name) ?? [];
    responses.push(response);
    this.responses.set(method.name, responses);
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    const responses = this.responses.get(method.name);
    if (!responses?.length) {
      throw new Error(`No fake response queued for ${method.name}`);
    }
    return method.result.parse(responses.shift()) as z.output<Method["result"]>;
  }

  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  emitNotification(notification: StagehandRpcNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }

  get notificationListenerCount(): number {
    return this.notificationListeners.size;
  }

  close(): void {
    this.closed = true;
  }
}

describe("Stagehand", () => {
  it("throws a clear error when context is used before init", () => {
    const stagehand = new Stagehand({
      browser: {
        type: "cdp",
        cdpUrl: "http://127.0.0.1:9222",
      },
    });

    expect(() => stagehand.context).toThrow("Call stagehand.init() before using context");
  });

  it("initializes through browser source resolution and RPC client connection", async () => {
    const rpcClient = new FakeRPCClient();
    rpcClient.queueResponse(StagehandMethods.contextPages, [
      { pageId: "page-1", url: "about:blank" },
    ]);
    const resolveBrowserSource = vi.fn(async (): Promise<ResolvedBrowserSource> => {
      return {
        cdpUrl: "http://127.0.0.1:9222",
        keepAlive: true,
      };
    });
    const connectRpcClient = vi.fn(async () => rpcClient);

    const stagehand = createStagehandWithDependenciesForTest(
      {
        apiKey: "bb_key",
        browser: {
          type: "cdp",
          cdpUrl: "http://127.0.0.1:9222",
        },
      },
      {
        resolveBrowserSource,
        connectRpcClient,
      },
    );

    await stagehand.init();
    const pages = await stagehand.context.pages();

    expect(stagehand.initialized).toBe(true);
    expect(resolveBrowserSource).toHaveBeenCalledWith({
      apiKey: "bb_key",
      browser: {
        type: "cdp",
        cdpUrl: "http://127.0.0.1:9222",
      },
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    });
    expect(connectRpcClient).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: expect.stringContaining("packages/server/dist") as string,
      serviceWorkerUrlIncludes: "service-worker.js",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    } satisfies RPCClientOptions);
    expect(pages[0]?.pageId).toBe("page-1");
    expect(rpcClient.calls).toStrictEqual([
      {
        method: "stagehand.init",
        params: {
          apiKey: "bb_key",
          telemetry: {
            traces: {
              endpoint: "https://example.com/v1/traces",
              headers: {},
            },
          },
        },
      },
      { method: "context.pages", params: {} },
    ]);
  });

  it("passes Browserbase credentials and browser settings to the worker", async () => {
    const rpcClient = new FakeRPCClient();
    const connectRpcClient = vi.fn(async () => rpcClient);
    const stagehand = createStagehandWithDependenciesForTest(
      {
        apiKey: "bb_key",
        browser: {
          type: "browserbase",
          keepAlive: true,
          region: "eu-central-1",
          userMetadata: { suite: "smoke" },
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
          browserbaseSessionId: "session_123",
          preloadedExtension: true,
          keepAlive: true,
        }),
        connectRpcClient,
      },
    );

    await stagehand.init();

    expect(connectRpcClient).toHaveBeenCalledWith({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session",
      preloadedExtension: true,
      serviceWorkerUrlIncludes: "service-worker.js",
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: {},
        },
      },
    } satisfies RPCClientOptions);

    expect(rpcClient.calls).toStrictEqual([
      {
        method: "stagehand.init",
        params: {
          apiKey: "bb_key",
          browser: {
            type: "browserbase",
            sessionId: "session_123",
            keepAlive: true,
            region: "eu-central-1",
            userMetadata: { suite: "smoke" },
          },
          telemetry: {
            traces: {
              endpoint: "https://example.com/v1/traces",
              headers: {},
            },
          },
        },
      },
    ]);
  });

  it("passes the configured OTLP traces destination to the worker RPC client", async () => {
    const rpcClient = new FakeRPCClient();
    const connectRpcClient = vi.fn(async () => rpcClient);
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: {
          type: "cdp",
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
        connectRpcClient,
      },
    );

    await stagehand.init();

    expect(connectRpcClient).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: expect.stringContaining("packages/server/dist") as string,
      serviceWorkerUrlIncludes: "service-worker.js",
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
    } satisfies RPCClientOptions);
  });

  it("registers a client LLM and sends its serializable model reference during initialization", async () => {
    const rpcClient = new FakeRPCClient();
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: {
          type: "cdp",
          cdpUrl: "http://127.0.0.1:9222",
        },
        model: {
          generate: async () => ({
            role: "assistant",
            content: { type: "text", text: "Hello" },
            outputFormat: "text",
          }),
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
        }),
        connectRpcClient: async () => rpcClient,
      },
    );

    await stagehand.init();

    expect(rpcClient.requestHandlers.has("llm.generate")).toBe(true);
    expect(rpcClient.calls).toStrictEqual([
      {
        method: "stagehand.init",
        params: {
          model: { source: "client" },
          telemetry: {
            traces: {
              endpoint: "https://example.com/v1/traces",
              headers: {},
            },
          },
        },
      },
    ]);
  });

  it("closes the runtime, rpcClient, and owned browser source", async () => {
    const closeBrowser = vi.fn();
    const rpcClient = new FakeRPCClient();
    rpcClient.queueResponse(StagehandMethods.stagehandClose, { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: { type: "local" },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: false,
          close: closeBrowser,
        }),
        connectRpcClient: async () => rpcClient,
      },
    );

    await stagehand.init();
    await stagehand.close();

    expect(stagehand.initialized).toBe(false);
    expect(rpcClient.calls).toStrictEqual([
      {
        method: "stagehand.init",
        params: {
          telemetry: {
            traces: {
              endpoint: "https://example.com/v1/traces",
              headers: {},
            },
          },
        },
      },
      { method: "stagehand.close", params: {} },
    ]);
    expect(rpcClient.closed).toBe(true);
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(() => stagehand.context).toThrow("Call stagehand.init() before using context");
  });

  it("renders streamed Stagehand logs and removes the listener when Stagehand closes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const rpcClient = new FakeRPCClient();
    rpcClient.queueResponse(StagehandMethods.stagehandClose, { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: {
          type: "cdp",
          cdpUrl: "http://127.0.0.1:9222",
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
        }),
        connectRpcClient: async () => rpcClient,
      },
    );

    await stagehand.init();
    rpcClient.emitNotification({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "info",
        message: "Page opened",
        data: { pageId: "page-1" },
      },
    });

    expect(info).toHaveBeenCalledWith("Page opened", { pageId: "page-1" });
    expect(rpcClient.notificationListenerCount).toBe(1);

    await stagehand.close();

    expect(rpcClient.notificationListenerCount).toBe(0);
    info.mockRestore();
  });

  it("does not close a keepAlive browser source", async () => {
    const closeBrowser = vi.fn();
    const rpcClient = new FakeRPCClient();
    rpcClient.queueResponse(StagehandMethods.stagehandClose, { closed: true });
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: {
          type: "local",
          keepAlive: true,
        },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: true,
          close: closeBrowser,
        }),
        connectRpcClient: async () => rpcClient,
      },
    );

    await stagehand.init();
    await stagehand.close();

    expect(rpcClient.closed).toBe(true);
    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it("cleans up an owned browser source when RPC client connection fails", async () => {
    const closeBrowser = vi.fn();
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: { type: "local" },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: false,
          close: closeBrowser,
        }),
        connectRpcClient: async () => {
          throw new Error("RPC client failed");
        },
      },
    );

    await expect(stagehand.init()).rejects.toThrow("RPC client failed");
    expect(stagehand.initialized).toBe(false);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("preserves initialization and cleanup failures without masking either error", async () => {
    const initError = new Error("RPC client failed");
    const cleanupError = new Error("Browserbase cleanup failed");
    const stagehand = createStagehandWithDependenciesForTest(
      {
        browser: { type: "local" },
      },
      {
        resolveBrowserSource: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          keepAlive: false,
          close: async () => {
            throw cleanupError;
          },
        }),
        connectRpcClient: async () => {
          throw initError;
        },
      },
    );

    const error = await stagehand.init().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toStrictEqual([initError, cleanupError]);
    expect((error as Error).cause).toBe(initError);
  });
});
