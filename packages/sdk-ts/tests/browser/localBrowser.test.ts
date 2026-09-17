import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalBrowserLauncherForTest,
  DEFAULT_CHROME_FLAGS,
  launchLocalBrowser,
  localBrowserChromeFlags,
} from "../../src/browser/localBrowser.js";

const WEBMCP_CHROME_FLAG = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport";

const EXPECTED_DEFAULT_CHROME_FLAGS = JSON.parse(
  readFileSync(
    new URL("../../../../tests/fixtures/local-browser-default-flags.json", import.meta.url),
    "utf8",
  ),
) as string[];

class FakeChromeProcess extends EventEmitter {
  pid = 123;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  spawned(): void {
    this.emit("spawn");
  }

  exited(code = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

function readyResponse(): Response {
  return new Response(
    JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/id" }),
    { headers: { "content-type": "application/json" } },
  );
}

function fakeLauncher(overrides: Record<string, unknown> = {}) {
  const child = new FakeChromeProcess();
  const removeProfile = vi.fn(async () => {});
  const spawnChrome = vi.fn((_executablePath: string, _args: string[]) => {
    queueMicrotask(() => child.spawned());
    return child as unknown as ChildProcess;
  });
  const signalProcess = vi.fn((_pid: number, signal: NodeJS.Signals) => {
    queueMicrotask(() => child.exited(0, signal));
  });
  const launch = createLocalBrowserLauncherForTest({
    platform: "darwin",
    env: {},
    getuid: undefined,
    isExecutableFile: async (filePath) => filePath === "/path/to/chrome",
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async () => "/tmp/stagehand-chrome-profile"),
    rm: removeProfile,
    spawnChrome,
    fetch: vi.fn(async () => readyResponse()),
    findAvailablePort: async () => 9_222,
    assertPortAvailable: async () => {},
    signalProcess,
    runTaskkill: async () => {
      queueMicrotask(() => child.exited());
    },
    ...overrides,
  });
  return { child, launch, removeProfile, signalProcess, spawnChrome };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("local browser Chrome flags", () => {
  it("uses the Stagehand defaults without disabling extensions", () => {
    expect(DEFAULT_CHROME_FLAGS).toStrictEqual(EXPECTED_DEFAULT_CHROME_FLAGS);
    expect(DEFAULT_CHROME_FLAGS).not.toContain("--disable-extensions");

    expect(localBrowserChromeFlags({}, 9_222, "/tmp/profile", false)).toStrictEqual([
      ...EXPECTED_DEFAULT_CHROME_FLAGS,
      "--window-size=1280,800",
      "--remote-debugging-port=9222",
      "--user-data-dir=/tmp/profile",
      "about:blank",
    ]);
  });

  it("supports every option-driven Chrome flag and keeps caller arguments last", () => {
    const flags = localBrowserChromeFlags(
      {
        args: ["--lang=fr", "--custom-flag=value"],
        headless: true,
        devtools: true,
        proxy: { server: "http://proxy.test:8080", bypass: "localhost" },
        locale: "de-CH",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        hasTouch: true,
        ignoreHTTPSErrors: true,
      },
      9_222,
      "/tmp/profile with spaces",
      true,
    );

    expect(flags).toEqual(
      expect.arrayContaining([
        "--window-size=1440,900",
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/profile with spaces",
        "--headless",
        "--auto-open-devtools-for-tabs",
        "--no-sandbox",
        "--proxy-server=http://proxy.test:8080",
        "--proxy-bypass-list=localhost",
        "--lang=de-CH",
        "--force-device-scale-factor=2",
        "--touch-events=enabled",
        "--ignore-certificate-errors",
      ]),
    );
    expect(flags.slice(-3)).toStrictEqual(["--lang=fr", "--custom-flag=value", "about:blank"]);
  });

  it("omits all implicit defaults while retaining required and explicit arguments", () => {
    expect(
      localBrowserChromeFlags(
        {
          ignoreDefaultArgs: true,
          viewport: { width: 1440, height: 900 },
          headless: true,
          args: ["--custom-flag"],
        },
        9_222,
        "/tmp/profile",
        false,
      ),
    ).toStrictEqual([
      "--window-size=1440,900",
      "--remote-debugging-port=9222",
      "--user-data-dir=/tmp/profile",
      "--headless",
      "--custom-flag",
      "about:blank",
    ]);
  });

  it("selectively omits Chrome and Stagehand defaults", () => {
    const ignoredChromeFlag = DEFAULT_CHROME_FLAGS[1];
    const flags = localBrowserChromeFlags(
      { ignoreDefaultArgs: [ignoredChromeFlag, WEBMCP_CHROME_FLAG] },
      9_222,
      "/tmp/profile",
      false,
    );

    expect(flags).not.toContain(ignoredChromeFlag);
    expect(flags).not.toContain(WEBMCP_CHROME_FLAG);
    expect(flags).toContain(DEFAULT_CHROME_FLAGS[0]);
    expect(flags).toContain("--enable-unsafe-extension-debugging");
  });

  it("retains an explicit viewport even when its matching default is ignored", () => {
    const windowSizeFlag = "--window-size=1440,900";
    expect(
      localBrowserChromeFlags(
        {
          viewport: { width: 1440, height: 900 },
          ignoreDefaultArgs: [windowSizeFlag],
        },
        9_222,
        "/tmp/profile",
        false,
      ),
    ).toContain(windowSizeFlag);
  });

  it("allows the implicit viewport default to be selectively omitted", () => {
    expect(
      localBrowserChromeFlags(
        { ignoreDefaultArgs: ["--window-size=1280,800"] },
        9_222,
        "/tmp/profile",
        false,
      ),
    ).not.toContain("--window-size=1280,800");
  });
});

describe("local browser launch lifecycle", () => {
  it("discovers Chrome, creates an owned profile, and waits for CDP readiness", async () => {
    const { launch, spawnChrome } = fakeLauncher();

    const browser = await launch({ executablePath: "/path/to/chrome", headless: true });

    expect(browser.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(spawnChrome).toHaveBeenCalledWith(
      "/path/to/chrome",
      expect.arrayContaining([
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/stagehand-chrome-profile",
        "--headless",
        "about:blank",
      ]),
      { detached: true, env: {} },
    );

    await browser.close();
  });

  it("treats an empty profile path as an SDK-owned temporary profile", async () => {
    const mkdir = vi.fn(async () => undefined);
    const mkdtemp = vi.fn(async () => "/tmp/empty-stagehand-chrome-profile");
    const { launch, removeProfile, spawnChrome } = fakeLauncher({ mkdir, mkdtemp });

    const browser = await launch({
      executablePath: "/path/to/chrome",
      userDataDir: "",
    });

    expect(mkdtemp).toHaveBeenCalledOnce();
    expect(mkdir).not.toHaveBeenCalled();
    expect(spawnChrome.mock.calls[0]?.[1]).toContain(
      "--user-data-dir=/tmp/empty-stagehand-chrome-profile",
    );

    await browser.close();
    expect(removeProfile).toHaveBeenCalledWith("/tmp/empty-stagehand-chrome-profile", {
      force: true,
      recursive: true,
    });
  });

  it("uses CHROME_PATH before platform candidates", async () => {
    const checked: string[] = [];
    const { launch, spawnChrome } = fakeLauncher({
      env: { CHROME_PATH: "/configured/chrome" },
      isExecutableFile: async (filePath: string) => {
        checked.push(filePath);
        return filePath === "/configured/chrome";
      },
    });

    const browser = await launch({});

    expect(checked).toStrictEqual(["/configured/chrome"]);
    expect(spawnChrome).toHaveBeenCalledWith(
      "/configured/chrome",
      expect.any(Array),
      expect.any(Object),
    );
    await browser.close();
  });

  it("discovers the supported macOS candidates in priority order", async () => {
    const checked: string[] = [];
    const { launch } = fakeLauncher({
      isExecutableFile: async (filePath: string) => {
        checked.push(filePath);
        return filePath.includes("Google Chrome Beta.app");
      },
    });

    const browser = await launch({});

    expect(checked).toStrictEqual([
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    ]);
    await browser.close();
  });

  it("discovers Windows and Linux installations using platform conventions", async () => {
    const windows = fakeLauncher({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\stagehand\\AppData\\Local" },
      isExecutableFile: async (filePath: string) => filePath.includes("Chrome\\Application"),
    });
    const windowsBrowser = await windows.launch({});
    expect(windows.spawnChrome.mock.calls[0]?.[0]).toBe(
      "C:\\Users\\stagehand\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    );
    await windowsBrowser.close();

    const linux = fakeLauncher({
      platform: "linux",
      env: { PATH: "/usr/local/bin:/usr/bin" },
      getuid: () => 1_000,
      isExecutableFile: async (filePath: string) => filePath === "/usr/bin/chromium",
    });
    const linuxBrowser = await linux.launch({});
    expect(linux.spawnChrome.mock.calls[0]?.[0]).toBe("/usr/bin/chromium");
    await linuxBrowser.close();
  });

  it("rejects unsupported platforms without creating a profile", async () => {
    const createProfile = vi.fn(async () => "/tmp/profile");
    const launch = createLocalBrowserLauncherForTest({
      platform: "freebsd",
      env: {},
      isExecutableFile: async () => false,
      mkdtemp: createProfile,
    });

    await expect(launch({})).rejects.toThrow("Chrome launching is not supported on freebsd");
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("rejects an occupied explicit port without spawning Chrome", async () => {
    const spawnChrome = vi.fn();
    const launch = createLocalBrowserLauncherForTest({
      isExecutableFile: async () => true,
      assertPortAvailable: async (port) => {
        throw new Error(`Chrome debugging port ${port} is already in use`);
      },
      spawnChrome,
    });

    await expect(launch({ executablePath: "/path/to/chrome", port: 9_222 })).rejects.toThrow(
      "Chrome debugging port 9222 is already in use",
    );
    expect(spawnChrome).not.toHaveBeenCalled();
  });

  it("rejects invalid options before discovering Chrome", async () => {
    const isExecutableFile = vi.fn(async () => true);
    const launch = createLocalBrowserLauncherForTest({ isExecutableFile });

    await expect(launch({ port: 0 })).rejects.toThrow("Chrome port must be an integer");
    await expect(launch({ viewport: { width: 0, height: 800 } })).rejects.toThrow(
      "Chrome viewport dimensions must be positive integers",
    );
    await expect(launch({ deviceScaleFactor: Number.NaN })).rejects.toThrow(
      "Chrome device scale factor must be positive and finite",
    );
    await expect(launch({ proxy: { server: "" } })).rejects.toThrow(
      "Chrome proxy server is required",
    );
    expect(isExecutableFile).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit executable without creating a profile", async () => {
    const createProfile = vi.fn(async () => "/tmp/profile");
    const launch = createLocalBrowserLauncherForTest({
      isExecutableFile: async () => false,
      mkdtemp: createProfile,
    });

    await expect(launch({ executablePath: "/missing/chrome" })).rejects.toThrow(
      'Chrome executable "/missing/chrome" does not exist',
    );
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("reports Chrome exit before readiness and removes its profile", async () => {
    const { child, launch, removeProfile } = fakeLauncher({
      fetch: vi.fn(() => new Promise<Response>(() => {})),
    });
    queueMicrotask(() => {
      child.spawned();
      child.exited(17);
    });

    await expect(launch({ executablePath: "/path/to/chrome" })).rejects.toThrow(
      "Chrome exited before its debugging port was ready with code 17",
    );
    expect(removeProfile).toHaveBeenCalledWith("/tmp/stagehand-chrome-profile", {
      force: true,
      recursive: true,
    });
  });

  it("cleans up after a spawn failure", async () => {
    const child = new FakeChromeProcess();
    const removeProfile = vi.fn(async () => {});
    const launch = createLocalBrowserLauncherForTest({
      isExecutableFile: async () => true,
      mkdtemp: async () => "/tmp/profile",
      rm: removeProfile,
      findAvailablePort: async () => 9_222,
      spawnChrome: () => {
        queueMicrotask(() => child.emit("error", new Error("spawn failed")));
        return child as unknown as ChildProcess;
      },
    });

    await expect(launch({ executablePath: "/path/to/chrome" })).rejects.toThrow("spawn failed");
    expect(removeProfile).toHaveBeenCalledOnce();
  });

  it("keeps polling until the CDP version response identifies a debugger", async () => {
    vi.useFakeTimers();
    const fetchChrome = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({})))
      .mockResolvedValueOnce(readyResponse());
    const { launch } = fakeLauncher({ fetch: fetchChrome });
    const launching = launch({ executablePath: "/path/to/chrome" });

    await vi.waitFor(() => expect(fetchChrome).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(100);
    const browser = await launching;

    expect(fetchChrome).toHaveBeenCalledTimes(2);
    await browser.close();
  });

  it("terminates and cleans up when launch is aborted", async () => {
    const controller = new AbortController();
    const fetchChrome = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
    });
    const { launch, removeProfile, signalProcess } = fakeLauncher({
      fetch: fetchChrome,
    });
    const launching = launch({ executablePath: "/path/to/chrome" }, controller.signal);
    await vi.waitFor(() => expect(fetchChrome).toHaveBeenCalledOnce());

    controller.abort(new Error("launch cancelled"));

    await expect(launching).rejects.toThrow("launch cancelled");
    expect(signalProcess).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(removeProfile).toHaveBeenCalledOnce();
  });

  it("closes once, terminates the Unix process group, and removes an owned profile", async () => {
    const { launch, removeProfile, signalProcess } = fakeLauncher();
    const browser = await launch({ executablePath: "/path/to/chrome" });

    await Promise.all([browser.close(), browser.close()]);

    expect(signalProcess).toHaveBeenCalledOnce();
    expect(signalProcess).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(removeProfile).toHaveBeenCalledOnce();
  });

  it("force-kills the Unix process group after the graceful window", async () => {
    vi.useFakeTimers();
    const child = new FakeChromeProcess();
    const signalProcess = vi.fn((_pid: number, signal: NodeJS.Signals) => {
      if (signal === "SIGKILL") queueMicrotask(() => child.exited(0, signal));
    });
    const { launch } = fakeLauncher({
      signalProcess,
      spawnChrome: () => {
        queueMicrotask(() => child.spawned());
        return child as unknown as ChildProcess;
      },
    });
    const browser = await launch({ executablePath: "/path/to/chrome" });

    const closing = browser.close();
    await vi.advanceTimersByTimeAsync(3_000);
    await closing;

    expect(signalProcess.mock.calls).toStrictEqual([
      [-123, "SIGTERM"],
      [-123, "SIGKILL"],
    ]);
  });

  it("preserves caller-owned and explicitly preserved profiles", async () => {
    const callerOwned = fakeLauncher();
    const callerBrowser = await callerOwned.launch({
      executablePath: "/path/to/chrome",
      userDataDir: "/tmp/caller-profile",
    });
    await callerBrowser.close();
    expect(callerOwned.removeProfile).not.toHaveBeenCalled();

    const preserved = fakeLauncher();
    const preservedBrowser = await preserved.launch({
      executablePath: "/path/to/chrome",
      preserveUserDataDir: true,
    });
    await preservedBrowser.close();
    expect(preserved.removeProfile).not.toHaveBeenCalled();
  });

  it("uses taskkill to terminate the Windows process tree", async () => {
    const child = new FakeChromeProcess();
    const runTaskkill = vi.fn(async (_pid: number, force: boolean) => {
      if (!force) queueMicrotask(() => child.exited());
    });
    const { launch } = fakeLauncher({
      platform: "win32",
      runTaskkill,
      spawnChrome: () => {
        queueMicrotask(() => child.spawned());
        return child as unknown as ChildProcess;
      },
    });
    const browser = await launch({ executablePath: "/path/to/chrome" });

    await browser.close();

    expect(runTaskkill).toHaveBeenCalledWith(123, false);
  });

  it("surfaces both process termination and profile cleanup failures", async () => {
    const processError = Object.assign(new Error("termination failed"), { code: "EPERM" });
    const profileError = new Error("profile cleanup failed");
    const { launch } = fakeLauncher({
      signalProcess: () => {
        throw processError;
      },
      rm: async () => {
        throw profileError;
      },
    });
    const browser = await launch({ executablePath: "/path/to/chrome" });

    const rejection = await browser.close().catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toStrictEqual([processError, profileError]);
  });
});

describe("local browser launch validation", () => {
  it("rejects authenticated proxies before attempting to discover or launch Chrome", async () => {
    await expect(
      launchLocalBrowser({
        proxy: {
          server: "http://proxy.test:8080",
          username: "user",
        },
      }),
    ).rejects.toThrow("Authenticated local browser proxies are not supported yet");
  });
});
