import { describe, expect, it, vi } from "vitest";
import {
  claimStagehandBrowser,
  createBrowserFactoriesForTest,
  invalidateStagehandBrowser,
} from "../../src/browser/factories.js";
import { attachStagehandBrowserContext } from "../../src/browser/index.js";
import type { BrowserContext } from "../../src/browserContext.js";
import {
  CDPConnectionClosedError,
  type CDPClient,
  type CDPClientOptions,
} from "../../src/cdpClient.js";

function fakeCdpClient(
  close = vi.fn(),
  sendCommand: ReturnType<typeof vi.fn> = vi.fn(async () => ({})),
) {
  return { close, sendCommand, detachClient: vi.fn(async () => {}) } as unknown as CDPClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Stagehand browser factories", () => {
  describe.each<Record<string, string> | undefined>([
    undefined,
    {},
    { Authorization: "Bearer test-token", "X-Api-Key": "test-key" },
  ])("local connect headers %j", (headers) => {
    it.each([undefined, "ws://localhost:9222/devtools/browser/extension"])(
      "keeps headers client-side with extension URL %s",
      async (extensionCdpUrl) => {
        const connectCdp = vi.fn(async (_options: CDPClientOptions) => fakeCdpClient());
        const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });
        const browser = await localBrowser.connect({
          cdpUrl: "wss://gateway.example/browser",
          headers,
          extensionCdpUrl,
        });
        expect(connectCdp.mock.calls[0]?.[0].headers).toEqual(headers);
        expect(claimStagehandBrowser(browser).workerInitMetadata).toStrictEqual({
          browserCdpUrl: extensionCdpUrl,
        });
        await invalidateStagehandBrowser(browser);
      },
    );
  });

  it.each([
    "",
    "http://browser",
    "https://browser",
    "ws://",
    "/devtools/browser/abc",
    "ws://browser:bad/devtools",
    "ws://browser:99999/devtools",
    "ws://browser:0/devtools",
    "wss://browser:0/devtools",
  ])("rejects invalid extension CDP URL %s before connecting", async (extensionCdpUrl) => {
    const connectCdp = vi.fn(async () => fakeCdpClient());
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });

    await expect(
      localBrowser.connect({ cdpUrl: "ws://browser", extensionCdpUrl }),
    ).rejects.toThrow();
    expect(connectCdp).not.toHaveBeenCalled();
  });

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
    expect(launchLocalBrowser).toHaveBeenCalledWith(
      {
        headless: true,
      },
      expect.any(AbortSignal),
    );
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

  it.each([undefined, "", "installed-stagehand", "wrong-id"])(
    "ignores local connect extension ID %s",
    async (extensionId) => {
      const cdp = fakeCdpClient();
      const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
      const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });

      const browser = await localBrowser.connect({
        cdpUrl: "wss://browser.example/devtools/browser/session",
        extensionId,
      });

      expect(connectCdp).toHaveBeenCalledWith(
        expect.objectContaining({
          localExtensionDir: expect.stringContaining("dist/extension"),
        }),
      );
      expect(connectCdp.mock.calls[0]?.[0]).not.toHaveProperty("extensionId");
      expect(browser).toMatchObject({ provider: "local", origin: "connected" });
    },
  );

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

  describe("disconnect()", () => {
    it("closes only the connection to a connected local browser", async () => {
      const closeCdp = vi.fn();
      const sendCommand = vi.fn(async () => ({}));
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
      });
      const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

      await browser.disconnect();

      expect(closeCdp).toHaveBeenCalledOnce();
      expect(sendCommand).not.toHaveBeenCalled();
      expect(browser.closed).toBe(true);
    });

    it.each([false, true])(
      "leaves a launched local browser running with keepAlive=%s",
      async (keepAlive) => {
        const closeSource = vi.fn();
        const closeCdp = vi.fn();
        const { localBrowser } = createBrowserFactoriesForTest({
          launchLocalBrowser: async () => ({ cdpUrl: "http://127.0.0.1:9222", close: closeSource }),
          connectCdp: async () => fakeCdpClient(closeCdp),
        });
        const browser = await localBrowser.launch({ keepAlive });

        await browser.disconnect();

        expect(closeCdp).toHaveBeenCalledOnce();
        expect(closeSource).not.toHaveBeenCalled();
      },
    );

    it.each([
      { origin: "launched" as const, keepAlive: false },
      { origin: "launched" as const, keepAlive: true },
      { origin: "connected" as const, keepAlive: true },
    ])(
      "does not release a $origin Browserbase session with keepAlive=$keepAlive",
      async ({ origin, keepAlive }) => {
        const closeSession = vi.fn();
        const session = {
          sessionId: "session_123",
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          close: closeSession,
        };
        const closeCdp = vi.fn();
        const { browserbase } = createBrowserFactoriesForTest({
          createBrowserbaseSessionClient: () => ({
            createSession: vi.fn(async () => session),
            connectSession: vi.fn(async () => session),
          }),
          connectCdp: async () => fakeCdpClient(closeCdp),
        });
        const browser =
          origin === "launched"
            ? await browserbase.launch({ apiKey: "bb_key", keepAlive })
            : await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

        await browser.disconnect();

        expect(closeCdp).toHaveBeenCalledOnce();
        expect(closeSession).not.toHaveBeenCalled();
      },
    );

    it("closes an attached Stagehand instance before the connection", async () => {
      const calls: string[] = [];
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => fakeCdpClient(vi.fn(() => calls.push("connection"))),
      });
      const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });
      claimStagehandBrowser(browser);
      attachStagehandBrowserContext(browser, {} as BrowserContext, async () => {
        calls.push("stagehand");
      });

      await browser.disconnect();

      expect(calls).toEqual(["stagehand", "connection"]);
    });

    it("still closes the connection when closing Stagehand fails", async () => {
      const closeCdp = vi.fn();
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => fakeCdpClient(closeCdp),
      });
      const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });
      claimStagehandBrowser(browser);
      attachStagehandBrowserContext(browser, {} as BrowserContext, async () => {
        throw new Error("stagehand.close failed");
      });

      await expect(browser.disconnect()).rejects.toThrow("stagehand.close failed");
      expect(closeCdp).toHaveBeenCalledOnce();
    });

    it("is terminal for a connected local browser: close() then rejects", async () => {
      const closeCdp = vi.fn();
      const sendCommand = vi.fn(async () => ({}));
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
      });
      const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

      await Promise.all([browser.disconnect(), browser.disconnect()]);
      await expect(browser.close()).rejects.toThrow(
        "The browser is disconnected; connect() again to close it",
      );

      expect(closeCdp).toHaveBeenCalledOnce();
      expect(sendCommand).not.toHaveBeenCalled();
      expect(() => claimStagehandBrowser(browser)).toThrow(
        "Cannot attach Stagehand to a closed browser",
      );
    });

    it.each([false, true])(
      "close() after disconnect() rejects and leaves a launched local browser running, keepAlive=%s",
      async (keepAlive) => {
        const closeSource = vi.fn();
        const sendCommand = vi.fn(async () => ({}));
        const { localBrowser } = createBrowserFactoriesForTest({
          launchLocalBrowser: async () => ({ cdpUrl: "http://127.0.0.1:9222", close: closeSource }),
          connectCdp: async () => fakeCdpClient(vi.fn(), sendCommand),
        });
        const browser = await localBrowser.launch({ keepAlive });

        await browser.disconnect();
        await expect(browser.close()).rejects.toThrow("connect() again to close it");
        await expect(browser.close()).rejects.toThrow("connect() again to close it");

        expect(closeSource).not.toHaveBeenCalled();
        expect(sendCommand).not.toHaveBeenCalled();
        expect(browser.closed).toBe(true);
      },
    );

    it.each([
      { origin: "launched" as const, keepAlive: false },
      { origin: "launched" as const, keepAlive: true },
      { origin: "connected" as const, keepAlive: true },
    ])(
      "close() after disconnect() rejects for a $origin Browserbase browser, keepAlive=$keepAlive",
      async ({ origin, keepAlive }) => {
        const closeSession = vi.fn();
        const session = {
          sessionId: "session_123",
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          close: closeSession,
        };
        const { browserbase } = createBrowserFactoriesForTest({
          createBrowserbaseSessionClient: () => ({
            createSession: vi.fn(async () => session),
            connectSession: vi.fn(async () => session),
          }),
          connectCdp: async () => fakeCdpClient(),
        });
        const browser =
          origin === "launched"
            ? await browserbase.launch({ apiKey: "bb_key", keepAlive })
            : await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

        await browser.disconnect();
        await expect(browser.close()).rejects.toThrow("connect() again to close it");

        expect(closeSession).not.toHaveBeenCalled();
      },
    );

    it("close() leaves a local browser alone once the connection is lost", async () => {
      const closeSource = vi.fn();
      const client = fakeCdpClient();
      const { localBrowser } = createBrowserFactoriesForTest({
        launchLocalBrowser: async () => ({ cdpUrl: "http://127.0.0.1:9222", close: closeSource }),
        connectCdp: async () => client,
      });
      const browser = await localBrowser.launch();

      (client as { closed: boolean }).closed = true;

      expect(browser.closed).toBe(true);
      await expect(browser.close()).resolves.toBeUndefined();
      expect(closeSource).not.toHaveBeenCalled();
      expect(client.sendCommand).not.toHaveBeenCalled();
      expect(() => claimStagehandBrowser(browser)).toThrow(
        "Cannot attach Stagehand to a closed browser",
      );
    });

    it.each(["launched", "connected"] as const)(
      "close() still releases a %s Browserbase session once the connection is lost",
      async (origin) => {
        const closeSession = vi.fn();
        const session = {
          sessionId: "session_123",
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
          close: closeSession,
        };
        const client = fakeCdpClient();
        const { browserbase } = createBrowserFactoriesForTest({
          createBrowserbaseSessionClient: () => ({
            createSession: vi.fn(async () => session),
            connectSession: vi.fn(async () => session),
          }),
          connectCdp: async () => client,
        });
        const browser =
          origin === "launched"
            ? await browserbase.launch({ apiKey: "bb_key", keepAlive: true })
            : await browserbase.connect({ apiKey: "bb_key", sessionId: "session_123" });

        (client as { closed: boolean }).closed = true;
        await Promise.all([browser.close(), browser.close()]);

        expect(closeSession).toHaveBeenCalledOnce();
      },
    );

    it("does nothing after close()", async () => {
      const closeCdp = vi.fn();
      const sendCommand = vi.fn(async () => ({}));
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => fakeCdpClient(closeCdp, sendCommand),
      });
      const browser = await localBrowser.connect({ cdpUrl: "ws://browser.example" });

      await browser.close();
      await browser.disconnect();

      expect(sendCommand).toHaveBeenCalledOnce();
      expect(closeCdp).toHaveBeenCalledOnce();
    });
  });

  it("sends Browser.close to a launched local browser before terminating it", async () => {
    const calls: string[] = [];
    const { localBrowser } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({
        cdpUrl: "http://127.0.0.1:9222",
        close: async () => {
          calls.push("terminate");
        },
      }),
      connectCdp: async () =>
        fakeCdpClient(
          vi.fn(() => calls.push("disconnect")),
          vi.fn(async (method: string) => {
            calls.push(method);
            return {};
          }),
        ),
    });
    const browser = await localBrowser.launch();

    await browser.close();

    expect(calls).toEqual(["Browser.close", "terminate", "disconnect"]);
  });

  it("exposes the CDP URL of local browsers only", async () => {
    const session = {
      sessionId: "session_123",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
      close: vi.fn(),
    };
    const { localBrowser, browserbase } = createBrowserFactoriesForTest({
      launchLocalBrowser: async () => ({ cdpUrl: "http://127.0.0.1:9333", close: vi.fn() }),
      createBrowserbaseSessionClient: () => ({
        createSession: vi.fn(async () => session),
        connectSession: vi.fn(async () => session),
      }),
      connectCdp: async () => fakeCdpClient(),
    });

    expect((await localBrowser.launch()).cdpUrl).toBe("http://127.0.0.1:9333");
    expect((await localBrowser.connect({ cdpUrl: "ws://browser.example" })).cdpUrl).toBe(
      "ws://browser.example",
    );
    expect((await browserbase.launch({ apiKey: "bb_key" })).cdpUrl).toBeUndefined();
  });

  it.each([
    ["local", "launched", false, true],
    ["local", "launched", true, false],
    ["local", "connected", false, false],
    ["browserbase", "launched", false, false],
    ["browserbase", "connected", false, false],
  ] as const)(
    "client-loss policy: %s/%s keepAlive=%s shuts the browser down: %s",
    async (provider, origin, keepAlive, terminate) => {
      const cdp = fakeCdpClient();
      const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
      const source = { cdpUrl: "ws://browser", sessionId: "session", close: vi.fn() };
      const factories = createBrowserFactoriesForTest({
        connectCdp,
        launchLocalBrowser: async () => source,
        createBrowserbaseSessionClient: () => ({
          createSession: async () => source,
          connectSession: async () => source,
        }),
      });
      const browser =
        provider === "local"
          ? origin === "launched"
            ? await factories.localBrowser.launch({ keepAlive })
            : await factories.localBrowser.connect({ cdpUrl: source.cdpUrl })
          : origin === "launched"
            ? await factories.browserbase.launch({ apiKey: "key", keepAlive })
            : await factories.browserbase.connect({ apiKey: "key", sessionId: "session" });
      expect(connectCdp.mock.calls[0]?.[0].clientLifecycle?.closeBrowserOnDisconnect).toBe(
        terminate,
      );
      await Promise.all([browser.disconnect(), browser.disconnect()]);
      expect(cdp.detachClient).toHaveBeenCalledOnce();
      expect(cdp.close).toHaveBeenCalledOnce();
      expect(source.close).not.toHaveBeenCalled();
    },
  );

  it("keeps the socket and the handle open when detach is not acknowledged", async () => {
    const cdp = fakeCdpClient();
    vi.mocked(cdp.detachClient).mockRejectedValueOnce(new Error("detach failed"));
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp: async () => cdp });
    const browser = await localBrowser.connect({ cdpUrl: "ws://browser" });

    await expect(browser.disconnect()).rejects.toThrow("detach failed");
    expect(cdp.close).not.toHaveBeenCalled();
    expect(browser.closed).toBe(false);

    await browser.disconnect();
    expect(cdp.close).toHaveBeenCalledOnce();
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
      clientOptions: { timeout: 5_000, defaultHeaders: { "X-Caller": "app" } },
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
      { timeout: 5_000, defaultHeaders: { "X-Caller": "app" } },
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

  it.each([undefined, "", "installed-stagehand", "wrong-id"])(
    "ignores Browserbase connect extension ID %s",
    async (extensionId) => {
      const connectSession = vi.fn(async () => ({
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        region: "eu-central-1" as const,
        close: vi.fn(),
      }));
      const cdp = fakeCdpClient();
      const connectCdp = vi.fn(async (_options: CDPClientOptions) => cdp);
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
        extensionId,
        clientOptions: { maxRetries: 0 },
      });

      expect(connectSession).toHaveBeenCalledWith("session_123");
      expect(createBrowserbaseSessionClient).toHaveBeenCalledWith(
        "bb_key",
        "https://api.dev.browserbase.com",
        { maxRetries: 0 },
      );
      expect(connectCdp).toHaveBeenCalledWith(
        expect.objectContaining({ preloadedExtension: true }),
      );
      expect(connectCdp.mock.calls[0]?.[0]).not.toHaveProperty("extensionId");
      expect(connectCdp.mock.calls[0]?.[0]).not.toHaveProperty("localExtensionDir");
      expect(browser).toMatchObject({ provider: "browserbase", origin: "connected" });
      expect(claimStagehandBrowser(browser).workerInitMetadata).toStrictEqual({
        apiKey: "bb_key",
        browser: {
          sessionId: "session_123",
          region: "eu-central-1",
        },
      });
    },
  );

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
  it("delegates Browserbase search and fetch requests", async () => {
    const search = vi.fn(async () => ({
      query: "browser agents",
      requestId: "request_123",
      results: [{ id: "result_123", title: "Stagehand", url: "https://stagehand.dev" }],
    }));
    const fetch = vi.fn(async () => ({
      id: "fetch_123",
      content: "# Stagehand",
      contentType: "text/markdown",
      encoding: "utf-8",
      headers: { "content-type": "text/html" },
      statusCode: 200,
    }));
    const createBrowserbaseServicesClient = vi.fn(() => ({ search, fetch }));
    const { browserbase } = createBrowserFactoriesForTest({
      createBrowserbaseServicesClient,
    });

    await expect(
      browserbase.search({
        apiKey: "bb_key",
        baseUrl: "https://api.dev.browserbase.com",
        query: "browser agents",
        numResults: 5,
      }),
    ).resolves.toMatchObject({ requestId: "request_123" });
    await expect(
      browserbase.fetch({
        apiKey: "bb_key",
        baseUrl: "https://api.dev.browserbase.com",
        url: "https://stagehand.dev",
        format: "markdown",
      }),
    ).resolves.toMatchObject({ statusCode: 200 });

    expect(createBrowserbaseServicesClient).toHaveBeenCalledTimes(2);
    expect(createBrowserbaseServicesClient).toHaveBeenCalledWith(
      "bb_key",
      "https://api.dev.browserbase.com",
    );
    expect(search).toHaveBeenCalledWith({ query: "browser agents", numResults: 5 });
    expect(fetch).toHaveBeenCalledWith({
      url: "https://stagehand.dev",
      format: "markdown",
    });
  });

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

  it.each([
    { origin: "launched" as const, expectedSessionCloses: 1 },
    { origin: "connected" as const, expectedSessionCloses: 0 },
  ])(
    "releases only a newly $origin Browserbase session when CDP attach fails",
    async ({ origin, expectedSessionCloses }) => {
      const closeSession = vi.fn(async () => {});
      const session = {
        sessionId: "session_123",
        cdpUrl: "wss://connect.browserbase.com/devtools/browser/session_123",
        close: closeSession,
      };
      const attachError = new Error("extension attach failed");
      const { browserbase } = createBrowserFactoriesForTest({
        createBrowserbaseSessionClient: () => ({
          createSession: async () => session,
          connectSession: async () => session,
        }),
        connectCdp: async () => {
          throw attachError;
        },
      });

      const connecting =
        origin === "launched"
          ? browserbase.launch({ apiKey: "bb_key", keepAlive: true })
          : browserbase.connect({ apiKey: "bb_key", sessionId: session.sessionId });

      await expect(connecting).rejects.toBe(attachError);
      expect(closeSession).toHaveBeenCalledTimes(expectedSessionCloses);
    },
  );

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
