import { describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { Stagehand, StagehandCreateOptionsSchema } from "../src/index.js";
import { createBrowserFactoriesForTest } from "../src/browser/factories.js";
import type { CDPClient } from "../src/cdpClient.js";

class FakeCDPClient {
  readonly webSocketDebuggerUrl = "ws://127.0.0.1:9222/devtools/browser/test";
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  close = vi.fn();
  initError: Error | undefined;
  readonly requests: JSONRPCMessage[] = [];

  async send(message: JSONRPCMessage): Promise<void> {
    this.requests.push(message);
    if (!("id" in message) || !("method" in message)) return;
    if (message.method === "stagehand.init" && this.initError) {
      throw this.initError;
    }

    const result =
      message.method === "stagehand.init"
        ? { initialized: true, pages: [] }
        : message.method === "stagehand.close"
          ? { closed: true }
          : {};
    await this.onmessage?.({ jsonrpc: "2.0", id: message.id, result });
  }
}

describe("Stagehand.create", () => {
  it("attaches to a ready browser without taking transport ownership", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const stagehand = await Stagehand.create({ browser, apiKey: "bb_worker_key" });

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.browser).toBe(browser);
    expect("init" in stagehand).toBe(false);
    expect(cdp.requests[0]).toMatchObject({
      method: "stagehand.init",
      params: {
        browser_cdp_url: cdp.webSocketDebuggerUrl,
        log_level: "info",
        api_key: "bb_worker_key",
      },
    });

    await stagehand.close();
    expect(cdp.close).not.toHaveBeenCalled();

    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });

  it("releases the browser claim when initialization fails", async () => {
    const cdp = new FakeCDPClient();
    cdp.initError = new Error("worker initialization failed");
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    await expect(Stagehand.create({ browser })).rejects.toThrow("worker initialization failed");

    cdp.initError = undefined;
    const stagehand = await Stagehand.create({ browser });
    expect(stagehand.initialized).toBe(true);

    await stagehand.close();
    await browser.close();
  });

  it("rejects browser-like objects not created by a Stagehand factory", async () => {
    await expect(
      Stagehand.create({
        browser: {
          provider: "local",
          origin: "connected",
          closed: false,
          close: async () => {},
        } as never,
      }),
    ).rejects.toThrow("browser must be created by localBrowser or browserbase");
  });

  it("rejects unknown create options at the public boundary", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    expect(() => StagehandCreateOptionsSchema.parse({ browser, unexpected: true })).toThrow(
      "Unrecognized key",
    );

    await browser.close();
  });
});
