import { describe, expect, it, vi } from "vitest";
import {
  claimStagehandBrowser,
  createBrowserFactoriesForTest,
} from "../../src/browser/factories.js";
import type { CDPClient, CDPClientOptions } from "../../src/cdpClient.js";

function fakeCdpClient(close = vi.fn()) {
  return { close } as unknown as CDPClient;
}

describe("Stagehand browser factories", () => {
  it("launches a local browser and prepares the packaged extension", async () => {
    const closeSource = vi.fn();
    const launchLocalBrowser = vi.fn(async () => ({
      cdpUrl: "http://127.0.0.1:9222",
      close: closeSource,
    }));
    const closeCdp = vi.fn();
    const cdp = fakeCdpClient(closeCdp);
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser,
      connectCdp,
    });

    const browser = await localBrowser.launch({ headless: true, connectTimeoutMs: 2_000 });

    expect(browser).toMatchObject({ provider: "local", origin: "launched", closed: false });
    expect(launchLocalBrowser).toHaveBeenCalledWith({
      headless: true,
      connectTimeoutMs: 2_000,
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

  it("connects to local CDP with a preloaded extension ID", async () => {
    const cdp = fakeCdpClient();
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });

    const browser = await localBrowser.connect({
      cdpUrl: "wss://browser.example/devtools/browser/session",
      extensionId: "extension-id",
    });

    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: "extension-id",
      }),
    );
    expect(browser).toMatchObject({ provider: "local", origin: "connected" });
  });

  it("disconnects without closing a launched source configured to stay alive", async () => {
    const closeSource = vi.fn();
    const closeCdp = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        close: closeSource,
      }),
      connectCdp: async () => fakeCdpClient(closeCdp),
    });

    const browser = await localBrowser.launch({ keepAlive: true });
    await browser.close();

    expect(closeCdp).toHaveBeenCalledOnce();
    expect(closeSource).not.toHaveBeenCalled();
  });

  it("launches Browserbase with worker initialization metadata", async () => {
    const closeSource = vi.fn();
    const createSession = vi.fn(async () => ({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      sessionId: "session_123",
      close: closeSource,
    }));
    const cdp = fakeCdpClient();
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient: () => ({ createSession }),
      connectCdp: async () => cdp,
    });

    const browser = await browserbase.launch({
      apiKey: "bb_key",
      projectId: "project_123",
      region: "us-west-2",
    });
    const claimed = claimStagehandBrowser(browser);

    expect(createSession).toHaveBeenCalledWith({
      projectId: "project_123",
      region: "us-west-2",
    });
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
    const connectCdp = vi.fn(async () => cdp);
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient: () => ({
        createSession: vi.fn(),
        connectSession,
      }),
      connectCdp,
    });

    const browser = await browserbase.connect({
      apiKey: "bb_key",
      sessionId: "session_123",
      extensionId: "extension-id",
    });

    expect(connectSession).toHaveBeenCalledWith("session_123");
    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: "extension-id" }),
    );
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

  it("rejects a second Stagehand claim", async () => {
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => fakeCdpClient(),
    });
    const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

    claimStagehandBrowser(browser);

    expect(() => claimStagehandBrowser(browser)).toThrow("already attached");
  });

  it("cleans up a launched source if extension preparation fails", async () => {
    const closeSource = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        close: closeSource,
      }),
      connectCdp: async () => {
        throw new Error("extension failed");
      },
    });

    await expect(localBrowser.launch()).rejects.toThrow("extension failed");
    expect(closeSource).toHaveBeenCalledOnce();
  });

  it("keeps a launched source alive if extension preparation fails", async () => {
    const closeSource = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        close: closeSource,
      }),
      connectCdp: async () => {
        throw new Error("extension failed");
      },
    });

    await expect(localBrowser.launch({ keepAlive: true })).rejects.toThrow("extension failed");
    expect(closeSource).not.toHaveBeenCalled();
  });
});
