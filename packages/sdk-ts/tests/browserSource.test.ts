import { describe, expect, it, vi } from "vite-plus/test";
import { resolveBrowserSource, type BrowserbaseSessionClient } from "../src/browserSource.js";

describe("resolveBrowserSource", () => {
  it("launches a local browser and returns the resolved CDP URL", async () => {
    const close = vi.fn();
    const launchLocalBrowser = vi.fn(async () => ({
      cdpUrl: "http://127.0.0.1:9222",
      close,
    }));

    await expect(
      resolveBrowserSource(
        {
          localBrowserLaunchOptions: {
            headless: false,
            keepAlive: true,
          },
        },
        { launchLocalBrowser },
      ),
    ).resolves.toStrictEqual({
      cdpUrl: "http://127.0.0.1:9222",
      keepAlive: true,
      close,
    });
    expect(launchLocalBrowser).toHaveBeenCalledWith({
      headless: false,
      keepAlive: true,
    });
  });

  it("connects to a local browser CDP URL without owning browser cleanup", async () => {
    await expect(
      resolveBrowserSource({
        localBrowserConnectOptions: {
          cdpUrl: "http://127.0.0.1:9333",
        },
      }),
    ).resolves.toStrictEqual({
      cdpUrl: "http://127.0.0.1:9333",
      keepAlive: true,
    });
  });

  it("creates a Browserbase session and returns its CDP URL", async () => {
    const close = vi.fn();
    const createSession = vi.fn(async () => ({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
      close,
    }));
    const connectToSession = vi.fn();
    const browserbase: BrowserbaseSessionClient = {
      createSession,
      connectToSession,
    };

    await expect(
      resolveBrowserSource(
        {
          browserbaseSessionCreateParams: {
            apiKey: "bb_key",
            keepAlive: false,
            region: "us-west-2",
          },
        },
        { browserbase },
      ),
    ).resolves.toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
      keepAlive: false,
      close,
    });
    expect(createSession).toHaveBeenCalledWith({
      apiKey: "bb_key",
      keepAlive: false,
      region: "us-west-2",
    });
    expect(connectToSession).not.toHaveBeenCalled();
  });

  it("connects directly to a Browserbase CDP URL", async () => {
    await expect(
      resolveBrowserSource({
        browserbaseConnectOptions: {
          cdpUrl: "wss://connect.browserbase.com/devtools/browser/existing-session",
          keepAlive: false,
        },
      }),
    ).resolves.toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/existing-session",
      keepAlive: false,
    });
  });

  it("resolves a Browserbase session ID to a CDP URL", async () => {
    const close = vi.fn();
    const createSession = vi.fn();
    const connectToSession = vi.fn(async () => ({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/resolved-session",
      close,
    }));
    const browserbase: BrowserbaseSessionClient = {
      createSession,
      connectToSession,
    };

    await expect(
      resolveBrowserSource(
        {
          browserbaseConnectOptions: {
            sessionId: "session_123",
            apiKey: "bb_key",
          },
        },
        { browserbase },
      ),
    ).resolves.toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/resolved-session",
      keepAlive: true,
      close,
    });
    expect(connectToSession).toHaveBeenCalledWith({
      sessionId: "session_123",
      apiKey: "bb_key",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects invalid constructor options before resolving a browser", async () => {
    const launchLocalBrowser = vi.fn();

    await expect(
      resolveBrowserSource(
        {
          localBrowserLaunchOptions: {},
          localBrowserConnectOptions: {
            cdpUrl: "http://127.0.0.1:9222",
          },
        },
        { launchLocalBrowser },
      ),
    ).rejects.toThrow("Provide exactly one browser source option");
    expect(launchLocalBrowser).not.toHaveBeenCalled();
  });
});
