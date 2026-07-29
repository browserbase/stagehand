import { describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import {
  createBrowserFactoriesForTest,
  type LocalBrowserLaunchOptions,
} from "../../browser/src/index.js";
import { Stagehand } from "../src/index.js";
import type { CDPClient } from "../src/cdpClient.js";

type RpcRequest = Extract<JSONRPCMessage, { id: number; method: string }>;

class FakeReadyTransport {
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  readonly webSocketDebuggerUrl = "ws://127.0.0.1:9222/devtools/browser/test";
  readonly requests: RpcRequest[] = [];
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  closed = false;
  failMethod: string | undefined;

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("id" in message) || !("method" in message)) return;
    const request = message as RpcRequest;
    this.requests.push(request);
    if (request.method === this.failMethod) {
      await this.onmessage?.(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: `${request.method} failed` },
        }),
      );
      return;
    }
    await this.onmessage?.(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: resultForMethod(request.method),
      }),
    );
  }

  close(): void {
    this.closed = true;
  }
}

function resultForMethod(method: string): unknown {
  switch (method) {
    case "runtime.configure":
      return { configured: true };
    case "stagehand.init":
      return { initialized: true, pages: [] };
    case "stagehand.close":
      return { closed: true };
    case "ping":
      return { ok: true, runtime: "service_worker" };
    default:
      throw new Error(`No fake response for ${method}`);
  }
}

function localFactories(
  options: {
    transport?: FakeReadyTransport;
    closeBrowser?: () => Promise<void> | void;
  } = {},
) {
  const transport = options.transport ?? new FakeReadyTransport();
  const closeBrowser = options.closeBrowser ?? vi.fn();
  const factories = createBrowserFactoriesForTest({
    resolveBrowserSource: async (input) => {
      const browser = (input as { browser: { type: string } }).browser;
      expect(browser.type).toBe("local");
      return {
        cdpUrl: "http://127.0.0.1:9222",
        keepAlive: false,
        close: closeBrowser,
      };
    },
    connectCdp: async () => transport as unknown as CDPClient,
  });
  return { ...factories, transport, closeBrowser };
}

describe("Stagehand.create", () => {
  it("creates an initialized Stagehand from an extension-ready browser", async () => {
    const { localBrowser, transport } = localFactories();
    const browser = await localBrowser.launch({ headless: true });

    const stagehand = await Stagehand.create({ browser });

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.browser).toBe(browser);
    expect(stagehand.context).toBeDefined();
    expect(transport.requests.map((request) => request.method)).toStrictEqual([
      "runtime.configure",
      "stagehand.init",
    ]);
  });

  it("passes Browserbase credentials and session metadata to stagehand.init", async () => {
    const transport = new FakeReadyTransport();
    const { browserbase } = createBrowserFactoriesForTest({
      resolveBrowserSource: async () => ({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        browserbaseSessionId: "session_123",
        preloadedExtension: true,
        keepAlive: false,
        close: vi.fn(),
      }),
      connectCdp: async () => transport as unknown as CDPClient,
    });
    const browser = await browserbase.launch({
      apiKey: "bb_key",
      region: "eu-central-1",
      userMetadata: { suite: "smoke" },
    });

    await Stagehand.create({ browser });

    expect(transport.requests.at(-1)).toMatchObject({
      method: "stagehand.init",
      params: {
        api_key: "bb_key",
        browser: {
          type: "browserbase",
          session_id: "session_123",
          region: "eu-central-1",
          user_metadata: { suite: "smoke" },
        },
      },
    });
  });

  it("allows each browser to be claimed only once", async () => {
    const { localBrowser } = localFactories();
    const browser = await localBrowser.launch();
    await Stagehand.create({ browser });

    await expect(Stagehand.create({ browser })).rejects.toThrow(
      "already attached to a Stagehand instance",
    );
  });

  it("rejects browser-shaped objects that were not created by a browser factory", async () => {
    const browser = {
      provider: "local",
      origin: "connected",
      closed: false,
      close: async () => {},
    };

    await expect(Stagehand.create({ browser: browser as never })).rejects.toThrow(
      "browser must be created by localBrowser or browserbase",
    );
  });

  it("closes Stagehand without closing the separately owned browser", async () => {
    const closeBrowser = vi.fn();
    const { localBrowser, transport } = localFactories({ closeBrowser });
    const browser = await localBrowser.launch();
    const stagehand = await Stagehand.create({ browser });

    await Promise.all([stagehand.close(), stagehand.close()]);

    expect(stagehand.initialized).toBe(false);
    expect(transport.closed).toBe(false);
    expect(closeBrowser).not.toHaveBeenCalled();
    await browser.close();
    expect(transport.closed).toBe(true);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("leaves browser resource cleanup to the caller when Stagehand initialization fails", async () => {
    const transport = new FakeReadyTransport();
    transport.failMethod = "stagehand.init";
    const closeBrowser = vi.fn();
    const { localBrowser } = localFactories({ transport, closeBrowser });
    const browser = await localBrowser.launch();

    await expect(Stagehand.create({ browser })).rejects.toThrow("stagehand.init failed");
    expect(transport.closed).toBe(false);
    expect(closeBrowser).not.toHaveBeenCalled();

    await browser.close();
    expect(transport.closed).toBe(true);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it("routes public methods through the initialized transport", async () => {
    const { localBrowser } = localFactories();
    const stagehand = await Stagehand.create({ browser: await localBrowser.launch() });

    await expect(stagehand.ping()).resolves.toStrictEqual({
      ok: true,
      runtime: "service_worker",
    });
  });

  it("accepts the generated local launch option type", () => {
    const options: LocalBrowserLaunchOptions = {
      headless: true,
      viewport: { width: 1280, height: 800 },
    };
    expect(options.headless).toBe(true);
  });
});
