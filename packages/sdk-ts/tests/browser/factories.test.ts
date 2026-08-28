import { describe, expect, it, vi } from "vitest";
import {
  claimStagehandBrowser,
  createBrowserFactoriesForTest,
  invalidateStagehandBrowser,
} from "../../src/browser/factories.js";
import {
  CDPConnectionClosedError,
  type CDPClient,
  type CDPClientOptions,
} from "../../src/cdpClient.js";

function fakeCdpClient(close = vi.fn(), sendCommand = vi.fn(async () => ({}))) {
  return { close, sendCommand } as unknown as CDPClient;
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

  it("explicitly closes a launched source configured to stay alive", async () => {
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
    expect(closeSource).toHaveBeenCalledOnce();
  });

  it("sends Browser.close before disconnecting from a connected local browser", async () => {
    const order: string[] = [];
    const sendCommand = vi.fn(async () => {
      order.push("terminate");
      return {};
    });
    const closeCdp = vi.fn(() => order.push("disconnect"));
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
    });
    const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

    await browser.close();

    expect(sendCommand).toHaveBeenCalledWith("Browser.close");
    expect(order).toStrictEqual(["terminate", "disconnect"]);
  });

  it("accepts CDP loss caused by Browser.close", async () => {
    const closeCdp = vi.fn();
    const sendCommand = vi.fn(async () => {
      throw new CDPConnectionClosedError();
    });
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
    });
    const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

    await expect(browser.close()).resolves.toBeUndefined();
    expect(closeCdp).toHaveBeenCalledOnce();
  });

  it("reports Browser.close dispatch failure and still disconnects", async () => {
    const closeCdp = vi.fn();
    const sendCommand = vi.fn(async () => {
      throw new Error("dispatch failed");
    });
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
    });
    const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

    await expect(browser.close()).rejects.toThrow("dispatch failed");
    expect(closeCdp).toHaveBeenCalledOnce();
  });

  it("reports source termination failure and still disconnects", async () => {
    const closeCdp = vi.fn();
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        close: async () => {
          throw new Error("termination failed");
        },
      }),
      connectCdp: async () => fakeCdpClient(closeCdp),
    });
    const browser = await localBrowser.launch();

    await expect(browser.close()).rejects.toThrow("termination failed");
    expect(closeCdp).toHaveBeenCalledOnce();
  });

  it.each([
    { origin: "launched" as const, keepAlive: false, expectedSourceCloses: 1 },
    { origin: "launched" as const, keepAlive: true, expectedSourceCloses: 0 },
    { origin: "connected" as const, keepAlive: true, expectedSourceCloses: 0 },
  ])(
    "invalidates a $origin local browser with keepAlive=$keepAlive",
    async ({ origin, keepAlive, expectedSourceCloses }) => {
      const closeSource = vi.fn();
      const closeCdp = vi.fn();
      const { localBrowser } = createBrowserFactoriesForTest({
        launchLocalBrowser: async () => ({
          cdpUrl: "http://127.0.0.1:9222",
          close: closeSource,
        }),
        connectCdp: async () => fakeCdpClient(closeCdp),
      });
      const browser =
        origin === "launched"
          ? await localBrowser.launch({ keepAlive })
          : await localBrowser.connect({ cdpUrl: "ws://browser.example" });

      await invalidateStagehandBrowser(browser);

      expect(browser.closed).toBe(true);
      expect(closeCdp).toHaveBeenCalledOnce();
      expect(closeSource).toHaveBeenCalledTimes(expectedSourceCloses);
    },
  );

  it.each([
    { origin: "launched" as const, keepAlive: false },
    { origin: "launched" as const, keepAlive: true },
    { origin: "connected" as const, keepAlive: true },
  ])(
    "explicitly closes a $origin Browserbase browser with keepAlive=$keepAlive",
    async ({ origin, keepAlive }) => {
      const order: string[] = [];
      const closeSession = vi.fn(async () => {
        order.push("release");
      });
      const createSession = vi.fn(async () => ({
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        close: closeSession,
      }));
      const connectSession = vi.fn(async () => ({
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        close: closeSession,
      }));
      const closeCdp = vi.fn(() => order.push("disconnect"));
      const { browserbase } = createBrowserFactoriesForTest({
        createBrowserbaseSessionClient: () => ({ createSession, connectSession }),
        connectCdp: async () => fakeCdpClient(closeCdp),
      });
      const browser =
        origin === "launched"
          ? await browserbase.launch({ apiKey: "bb_key", keepAlive })
          : await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

      await browser.close();

      expect(closeSession).toHaveBeenCalledOnce();
      expect(order).toStrictEqual(["release", "disconnect"]);
    },
  );

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

  it("connects to an existing Browserbase session", async () => {
    const connectSession = vi.fn(async () => ({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      region: "eu-central-1" as const,
      close: vi.fn(),
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

  it.each([
    { origin: "launched" as const, keepAlive: false, expectedSessionCloses: 1 },
    { origin: "launched" as const, keepAlive: true, expectedSessionCloses: 0 },
    { origin: "connected" as const, keepAlive: true, expectedSessionCloses: 0 },
  ])(
    "invalidates a $origin Browserbase browser with keepAlive=$keepAlive",
    async ({ origin, keepAlive, expectedSessionCloses }) => {
      const closeSession = vi.fn();
      const createSession = vi.fn(async () => ({
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        close: closeSession,
      }));
      const connectSession = vi.fn(async () => ({
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        close: closeSession,
      }));
      const closeCdp = vi.fn();
      const { browserbase } = createBrowserFactoriesForTest({
        createBrowserbaseSessionClient: () => ({ createSession, connectSession }),
        connectCdp: async () => fakeCdpClient(closeCdp),
      });
      const browser =
        origin === "launched"
          ? await browserbase.launch({ apiKey: "bb_key", keepAlive })
          : await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

      await invalidateStagehandBrowser(browser);

      expect(browser.closed).toBe(true);
      expect(closeCdp).toHaveBeenCalledOnce();
      expect(closeSession).toHaveBeenCalledTimes(expectedSessionCloses);
    },
  );

  it("discovers Stagehand when connecting without a Chrome extension ID", async () => {
    const connectSession = vi.fn(async () => ({
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      close: vi.fn(),
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
