import { describe, expect, it, vi } from "vitest";
import { claimStagehandBrowser, createBrowserFactoriesForTest } from "../src/index.js";
import type { CDPClient, CDPClientOptions } from "../../sdk-ts/src/cdpClient.js";

function fakeCdpClient(close = vi.fn()) {
  return {
    close,
  } as unknown as CDPClient;
}

describe("Stagehand browser factories", () => {
  it("launches a local browser and prepares the packaged extension", async () => {
    const closeSource = vi.fn();
    const resolveBrowserSource = vi.fn(async () => ({
      cdpUrl: "http://127.0.0.1:9222",
      keepAlive: false,
      close: closeSource,
    }));
    const closeCdp = vi.fn();
    const cdp = fakeCdpClient(closeCdp);
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
    const { localBrowser } = createBrowserFactoriesForTest({
      resolveBrowserSource,
      connectCdp,
    });

    const browser = await localBrowser.launch({ headless: true, connectTimeoutMs: 2_000 });

    expect(browser).toMatchObject({
      provider: "local",
      origin: "launched",
      closed: false,
    });
    expect(resolveBrowserSource).toHaveBeenCalledWith({
      browser: { type: "local", headless: true, connectTimeoutMs: 2_000 },
    });
    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: expect.stringContaining("dist/extension") as string,
        discoveryTimeoutMs: 2_000,
        cdpConnectTimeoutMs: 2_000,
      }),
    );

    await Promise.all([browser.close(), browser.close()]);
    expect(closeCdp).toHaveBeenCalledOnce();
    expect(closeSource).toHaveBeenCalledOnce();
  });

  it("connects to local CDP with headers and a preloaded extension ID", async () => {
    const cdp = fakeCdpClient();
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });

    const browser = await localBrowser.connect({
      cdpUrl: "wss://browser.example/devtools/browser/session",
      headers: { Authorization: "Bearer secret" },
      extensionId: "extension-id",
    });

    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpHeaders: { Authorization: "Bearer secret" },
        extensionId: "extension-id",
      }),
    );
    expect(browser).toMatchObject({ provider: "local", origin: "connected" });
  });

  it("launches Browserbase with opaque worker initialization metadata", async () => {
    const closeSource = vi.fn();
    const cdp = fakeCdpClient();
    const { browserbase } = createBrowserFactoriesForTest({
      resolveBrowserSource: async () => ({
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        browserbaseSessionId: "session_123",
        preloadedExtension: true,
        keepAlive: false,
        close: closeSource,
      }),
      connectCdp: async () => cdp,
    });

    const browser = await browserbase.launch({
      apiKey: "bb_key",
      region: "us-west-2",
    });
    const claimed = claimStagehandBrowser(browser);

    expect(claimed.workerInitMetadata).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        sessionId: "session_123",
        region: "us-west-2",
      },
    });
    expect(browser).toMatchObject({ provider: "browserbase", origin: "launched" });
  });

  it("connects to an existing Browserbase session without owning its release", async () => {
    const connectSession = vi.fn(async () => ({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1" as const,
    }));
    const cdp = fakeCdpClient();
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient: () => ({
        createSession: vi.fn(),
        connectSession,
      }),
      connectCdp: async () => cdp,
    });

    const browser = await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

    expect(connectSession).toHaveBeenCalledWith("session_123");
    expect(browser).toMatchObject({ provider: "browserbase", origin: "connected" });
    expect(claimStagehandBrowser(browser).workerInitMetadata).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        type: "browserbase",
        sessionId: "session_123",
        region: "eu-central-1",
      },
    });
  });

  it("cleans up a launched source if extension preparation fails", async () => {
    const closeSource = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      resolveBrowserSource: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        keepAlive: false,
        close: closeSource,
      }),
      connectCdp: async () => {
        throw new Error("extension failed");
      },
    });

    await expect(localBrowser.launch()).rejects.toThrow("extension failed");
    expect(closeSource).toHaveBeenCalledOnce();
  });
});
