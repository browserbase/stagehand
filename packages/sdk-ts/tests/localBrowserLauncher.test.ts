import { describe, expect, it, vi } from "vitest";
import {
  launchLocalBrowser,
  type LocalBrowserNodeRuntime,
  type LocalBrowserProcess,
} from "../src/runtime/node/localBrowserLauncher.js";

describe("local browser launcher", () => {
  it("launches Chrome with portable options and reads its assigned debugger port", async () => {
    const process = fakeBrowserProcess();
    const removeProfile = vi.fn(async () => {});
    const spawn = vi.fn<LocalBrowserNodeRuntime["spawn"]>(() => process);
    const runtime = fakeNodeRuntime({
      rm: removeProfile,
      spawn,
    });
    const fetchDebugger = vi.fn(async () => new Response("{}"));
    const loadExtension = vi.fn(async () => {});

    const launched = await launchLocalBrowser(
      {
        args: ["--custom-flag"],
        chromiumSandbox: false,
        deviceScaleFactor: 2,
        devtools: true,
        executablePath: "/browser/chrome",
        hasTouch: true,
        headless: true,
        ignoreDefaultArgs: ["--mute-audio"],
        ignoreHTTPSErrors: true,
        locale: "de-CH",
        proxy: { server: "http://proxy.test:8080", bypass: "localhost" },
        viewport: { width: 900, height: 700 },
      },
      { fetch: fetchDebugger, loadExtension, runtime },
    );

    expect(launched.cdpUrl).toBe("http://127.0.0.1:9444");
    expect(spawn).toHaveBeenCalledOnce();
    const [executablePath, flags, spawnOptions] = spawn.mock.calls[0]!;
    expect(executablePath).toBe("/browser/chrome");
    expect(flags).toEqual(
      expect.arrayContaining([
        "--custom-flag",
        "--enable-unsafe-extension-debugging",
        "--remote-allow-origins=*",
        "--remote-debugging-port=0",
        "--user-data-dir=/tmp/stagehand-chrome-profile",
        "--window-size=900,700",
        "--headless",
        "--auto-open-devtools-for-tabs",
        "--no-sandbox",
        "--proxy-server=http://proxy.test:8080",
        "--proxy-bypass-list=localhost",
        "--lang=de-CH",
        "--force-device-scale-factor=2",
        "--touch-events=enabled",
        "--ignore-certificate-errors",
        "about:blank",
      ]),
    );
    expect(flags).not.toContain("--mute-audio");
    expect(flags).not.toContain("--disable-extensions");
    expect(spawnOptions).toMatchObject({ detached: true, stdio: "ignore" });
    expect(fetchDebugger).toHaveBeenCalledWith("http://127.0.0.1:9444/json/version");
    expect(loadExtension).toHaveBeenCalledWith(
      "http://127.0.0.1:9444",
      expect.stringMatching(/packages\/server\/dist$/),
    );

    process.exitCode = 0;
    await launched.close();
    await launched.close();
    expect(removeProfile).toHaveBeenCalledOnce();
    expect(removeProfile).toHaveBeenCalledWith("/tmp/stagehand-chrome-profile", {
      force: true,
      recursive: true,
    });
  });

  it("uses a configured Chrome executable and preserves a caller-owned profile", async () => {
    const process = fakeBrowserProcess();
    const access = vi.fn(async () => {});
    const makeTemporaryProfile = vi.fn(async () => "/tmp/unused-profile");
    const removeProfile = vi.fn(async () => {});
    const spawn = vi.fn<LocalBrowserNodeRuntime["spawn"]>(() => process);
    const runtime = fakeNodeRuntime({
      access,
      env: { CHROME_PATH: "/configured/chrome", PATH: "" },
      mkdtemp: makeTemporaryProfile,
      rm: removeProfile,
      spawn,
    });

    const launched = await launchLocalBrowser(
      {
        port: 9222,
        userDataDir: "/profiles/stagehand",
      },
      { fetch: async () => new Response("{}"), loadExtension: async () => {}, runtime },
    );

    expect(access).toHaveBeenCalledWith("/configured/chrome");
    expect(makeTemporaryProfile).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      "/configured/chrome",
      expect.arrayContaining([
        "--remote-debugging-port=9222",
        "--user-data-dir=/profiles/stagehand",
      ]),
      expect.anything(),
    );

    process.exitCode = 0;
    await launched.close();
    expect(removeProfile).not.toHaveBeenCalled();
  });

  it("rejects unsupported host-only launch options before spawning", async () => {
    await expect(
      launchLocalBrowser({
        proxy: {
          server: "http://proxy.test:8080",
          username: "user",
        },
      }),
    ).rejects.toThrow("Authenticated local browser proxies");

    await expect(launchLocalBrowser({ acceptDownloads: true })).rejects.toThrow(
      "Local browser download options",
    );
  });
});

function fakeBrowserProcess(): LocalBrowserProcess {
  return {
    exitCode: null,
    pid: 1234,
    kill: vi.fn(() => true),
    once: vi.fn(),
  };
}

function fakeNodeRuntime(
  overrides: Partial<LocalBrowserNodeRuntime> = {},
): LocalBrowserNodeRuntime {
  return {
    access: vi.fn(async () => {}),
    delimiter: ":",
    env: { PATH: "/usr/bin" },
    join: (...parts) => parts.join("/").replaceAll("//", "/"),
    kill: vi.fn(),
    mkdtemp: vi.fn(async () => "/tmp/stagehand-chrome-profile"),
    platform: "darwin",
    readFile: vi.fn(async () => "9444\n/devtools/browser/test"),
    rm: vi.fn(async () => {}),
    spawn: vi.fn(() => fakeBrowserProcess()),
    tmpdir: () => "/tmp",
    ...overrides,
  };
}
