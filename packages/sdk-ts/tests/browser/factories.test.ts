import { describe, expect, it, vi } from "vitest";
import {
  claimStagehandBrowser,
  createBrowserFactoriesForTest,
} from "../../src/browser/factories.js";
import type { CDPClient, CDPClientOptions } from "../../src/cdpClient.js";

function fakeCdpClient(close = vi.fn()) {
  return { close } as unknown as CDPClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

    const browser = await localBrowser.launch({ headless: true });

    expect(browser).toMatchObject({ provider: "local", origin: "launched", closed: false });
    expect(launchLocalBrowser).toHaveBeenCalledWith({
      headless: true,
    });
    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpUrl: "http://127.0.0.1:9222",
        extensionDir: expect.stringContaining("dist/extension") as string,
        signal: expect.any(AbortSignal),
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
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
    const createBrowserbaseSessionClient = vi.fn(() => ({ createSession }));
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient,
      connectCdp,
    });

    const browser = await browserbase.launch({
      apiKey: "bb_key",
      baseUrl: "https://api.dev.browserbase.com",
      projectId: "project_123",
      region: "us-west-2",
    });
    const claimed = claimStagehandBrowser(browser);

    expect(createSession).toHaveBeenCalledWith({
      projectId: "project_123",
      region: "us-west-2",
    });
    expect(createBrowserbaseSessionClient).toHaveBeenCalledWith(
      "bb_key",
      "https://api.dev.browserbase.com",
    );
    expect(connectCdp).toHaveBeenCalledWith(expect.objectContaining({ preloadedExtension: true }));
    expect(claimed.workerInitMetadata).toStrictEqual({
      apiKey: "bb_key",
      browser: {
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
    const createBrowserbaseSessionClient = vi.fn(() => ({
      createSession: vi.fn(),
      connectSession,
    }));
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient,
      connectCdp,
    });

    const browser = await browserbase.connect({
      apiKey: "bb_key",
      baseUrl: "https://api.dev.browserbase.com",
      sessionId: "session_123",
      extensionId: "extension-id",
    });

    expect(connectSession).toHaveBeenCalledWith("session_123");
    expect(createBrowserbaseSessionClient).toHaveBeenCalledWith(
      "bb_key",
      "https://api.dev.browserbase.com",
    );
    expect(connectCdp).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: "extension-id" }),
    );
    expect(browser).toMatchObject({ provider: "browserbase", origin: "connected" });
    expect(claimStagehandBrowser(browser).workerInitMetadata).toStrictEqual({
      apiKey: "bb_key",
      browser: {
        sessionId: "session_123",
        region: "eu-central-1",
      },
    });
  });

  it("discovers Stagehand when connecting without a Chrome extension ID", async () => {
    const connectSession = vi.fn(async () => ({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
    }));
    const connectCdp = vi.fn(async (_options: CDPClientOptions) => fakeCdpClient());
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseSessionClient: () => ({
        createSession: vi.fn(),
        connectSession,
      }),
      connectCdp,
    });

    await browserbase.connect({
      apiKey: "bb_key",
      sessionId: "session_123",
    });

    expect(connectCdp).toHaveBeenCalledWith(expect.objectContaining({ preloadedExtension: true }));
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

  it("closes a connector that resolves after the internal lifecycle deadline", async () => {
    vi.useFakeTimers();
    const connection = deferred<CDPClient>();
    const closeCdp = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => connection.promise,
    });

    try {
      const connecting = localBrowser.connect({ cdpUrl: "ws://browser.example" });
      const rejection = expect(connecting).rejects.toThrow(
        "Stagehand initialization timed out after 60000ms",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;

      connection.resolve(fakeCdpClient(closeCdp));
      await vi.waitFor(() => expect(closeCdp).toHaveBeenCalledOnce());
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes an owned local browser that launches after the lifecycle deadline", async () => {
    vi.useFakeTimers();
    const launch = deferred<{ cdpUrl: string; close: () => Promise<void> }>();
    const closeSource = vi.fn(async () => {});
    const connectCdp = vi.fn(async () => fakeCdpClient());
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => launch.promise,
      connectCdp,
    });

    try {
      const launching = localBrowser.launch();
      const rejection = expect(launching).rejects.toThrow(
        "Stagehand initialization timed out after 60000ms",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;

      launch.resolve({ cdpUrl: "ws://late-browser", close: closeSource });
      await vi.waitFor(() => expect(closeSource).toHaveBeenCalledOnce());
      expect(connectCdp).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
