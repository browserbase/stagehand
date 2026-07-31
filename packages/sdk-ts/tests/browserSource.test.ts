import { describe, expect, it, vi } from "vitest";
import {
  launchLocalBrowser,
  localBrowserChromeFlags,
  resolveBrowserSource,
  WEBMCP_CHROME_FLAG,
  type BrowserbaseSessionClient,
} from "../src/browserSource.js";

const chromeLauncher = vi.hoisted(() => ({
  launch: vi.fn(),
  defaultFlags: vi.fn(() => [] as string[]),
  getInstallations: vi.fn(() => [] as string[]),
}));

vi.mock("chrome-launcher", () => ({
  launch: chromeLauncher.launch,
  Launcher: {
    defaultFlags: chromeLauncher.defaultFlags,
    getInstallations: chromeLauncher.getInstallations,
  },
}));
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
      residentBrowserConnection: false,
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
      residentBrowserConnection: false,
      keepAlive: true,
      close,
    });
    expect(launchLocalBrowser).toHaveBeenCalledWith({
      headless: false,
      keepAlive: true,
    });
  });

  it("uses client configuration for a local browser launched on another port", async () => {
    const launchLocalBrowser = vi.fn(async () => ({
      cdpUrl: "http://127.0.0.1:9333",
      close: vi.fn(),
    }));

    await expect(
      resolveBrowserSource({ browser: { type: "local", port: 9333 } }, { launchLocalBrowser }),
    ).resolves.toMatchObject({
      cdpUrl: "http://127.0.0.1:9333",
      residentBrowserConnection: false,
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
      residentBrowserConnection: false,
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

describe("launchLocalBrowser", () => {
  it("passes an explicit executable path to chrome-launcher without discovery", async () => {
    const kill = vi.fn();
    chromeLauncher.launch.mockResolvedValueOnce({ port: 9333, kill });

    const browser = await launchLocalBrowser({ executablePath: "/custom/chrome" });

    expect(chromeLauncher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ chromePath: "/custom/chrome" }),
    );
    expect(browser.cdpUrl).toBe("http://127.0.0.1:9333");
    browser.close();
    expect(kill).toHaveBeenCalledOnce();
  });

  it("resolves a browser automatically with chrome-launcher's compatibility discoveries", async () => {
    const kill = vi.fn();
    const findChromeExecutable = vi.fn(
      (options: { legacyInstallations?: () => readonly string[] }) => {
        return options.legacyInstallations?.()[0] ?? "/missing/chrome";
      },
    );
    chromeLauncher.getInstallations.mockReturnValueOnce(["/opt/google/chrome-wrapper"]);
    chromeLauncher.launch.mockResolvedValueOnce({ port: 9444, kill });

    await launchLocalBrowser({}, { findChromeExecutable });

    expect(findChromeExecutable).toHaveBeenCalledOnce();
    expect(chromeLauncher.getInstallations).toHaveBeenCalledOnce();
    expect(chromeLauncher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ chromePath: "/opt/google/chrome-wrapper" }),
    );
  });
});

describe("localBrowserChromeFlags", () => {
  const launcherDefaults = ["--disable-extensions", "--disable-background-networking"];

  it("enables WebMCP without disabling the Stagehand extension", () => {
    expect(localBrowserChromeFlags({}, launcherDefaults, false)).toEqual([
      "--disable-background-networking",
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      WEBMCP_CHROME_FLAG,
    ]);
  });

  it("omits all default flags when ignoreDefaultArgs is true", () => {
    expect(
      localBrowserChromeFlags(
        {
          ignoreDefaultArgs: true,
          args: ["--user-supplied"],
        },
        launcherDefaults,
        false,
      ),
    ).toEqual(["--user-supplied"]);
  });

  it("selectively omits the WebMCP flag while retaining other defaults", () => {
    const flags = localBrowserChromeFlags(
      {
        ignoreDefaultArgs: [WEBMCP_CHROME_FLAG],
      },
      launcherDefaults,
      false,
    );

    expect(flags).not.toContain(WEBMCP_CHROME_FLAG);
    expect(flags).toContain("--disable-background-networking");
    expect(flags).toContain("--enable-unsafe-extension-debugging");
  });

  it("appends launch options and user arguments after defaults", () => {
    const flags = localBrowserChromeFlags(
      {
        headless: true,
        devtools: true,
        args: ["--custom-flag"],
      },
      launcherDefaults,
      true,
    );

    expect(flags.slice(-4)).toEqual([
      "--headless",
      "--auto-open-devtools-for-tabs",
      "--no-sandbox",
      "--custom-flag",
    ]);
  });
});
