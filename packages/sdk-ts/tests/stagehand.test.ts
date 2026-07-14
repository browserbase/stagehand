import { describe, expect, it, vi } from "vite-plus/test";
import type { StagehandBridge, StagehandBridgeOptions } from "../../modcdp/index.js";
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
    });
    expect(connectBridge).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      extensionDir: expect.stringContaining("packages/extension/dist") as string,
      serviceWorkerUrlIncludes: "service-worker.js",
    } satisfies StagehandBridgeOptions);
    expect(pages[0]?.pageId).toBe("page-1");
    expect(bridge.calls).toStrictEqual([{ method: "context.pages", params: {} }]);
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
