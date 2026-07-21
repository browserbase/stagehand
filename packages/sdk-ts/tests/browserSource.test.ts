import { describe, expect, it, vi } from "vite-plus/test";
import { resolveBrowserSource, type BrowserbaseSessionClient } from "../src/browserSource.js";

describe("resolveBrowserSource", () => {
  it("creates a Browserbase session from the default browser source", async () => {
    const close = vi.fn();
    const createSession = vi.fn(async () => ({
      sessionId: "new-session",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
      close,
    }));
    const browserbase: BrowserbaseSessionClient = {
      createSession,
    };

    await expect(
      resolveBrowserSource(
        {
          apiKey: "bb_key",
        },
        { browserbase },
      ),
    ).resolves.toStrictEqual({
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
      browserbaseSessionId: "new-session",
      preloadedExtension: true,
      keepAlive: false,
      close,
    });
    expect(createSession).toHaveBeenCalledWith({});
  });

  it("passes flattened Browserbase settings without passing the API key", async () => {
    const createSession = vi.fn(async () => ({
      sessionId: "new-session",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
    }));
    const browserbase: BrowserbaseSessionClient = {
      createSession,
    };

    await resolveBrowserSource(
      {
        apiKey: "bb_key",
        browser: {
          type: "browserbase",
          keepAlive: true,
          region: "eu-central-1",
        },
      },
      { browserbase },
    );

    expect(createSession).toHaveBeenCalledWith({
      keepAlive: true,
      region: "eu-central-1",
    });
  });

  it("uses the root API key to create the Browserbase client", async () => {
    const createSession = vi.fn(async () => ({
      sessionId: "new-session",
      cdpUrl: "wss://connect.browserbase.com/devtools/browser/new-session",
    }));
    const createBrowserbaseSessionClient = vi.fn(() => ({ createSession }));

    await resolveBrowserSource(
      {
        apiKey: "bb_key",
      },
      { createBrowserbaseSessionClient },
    );

    expect(createBrowserbaseSessionClient).toHaveBeenCalledWith("bb_key");
    expect(createSession).toHaveBeenCalledWith({});
  });

  it("launches a local browser from flattened launch settings", async () => {
    const close = vi.fn();
    const launchLocalBrowser = vi.fn(async () => ({
      cdpUrl: "http://127.0.0.1:9222",
      close,
    }));

    await expect(
      resolveBrowserSource(
        {
          browser: {
            type: "local",
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

  it("connects to an existing CDP browser without owning its cleanup", async () => {
    await expect(
      resolveBrowserSource({
        browser: {
          type: "cdp",
          cdpUrl: "wss://browser.example/devtools/browser/session",
          headers: { Authorization: "Bearer secret" },
        },
      }),
    ).resolves.toStrictEqual({
      cdpUrl: "wss://browser.example/devtools/browser/session",
      cdpHeaders: { Authorization: "Bearer secret" },
      keepAlive: true,
    });
  });

  it("validates the browser source before performing browser work", async () => {
    const launchLocalBrowser = vi.fn();
    const createSession = vi.fn();
    const browserbase: BrowserbaseSessionClient = {
      createSession,
    };

    await expect(
      resolveBrowserSource(
        {
          browser: {
            type: "cdp",
          },
        },
        { browserbase, launchLocalBrowser },
      ),
    ).rejects.toThrow();
    expect(createSession).not.toHaveBeenCalled();
    expect(launchLocalBrowser).not.toHaveBeenCalled();
  });
});
