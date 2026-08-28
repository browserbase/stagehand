import { Launcher } from "chrome-launcher";
import { describe, expect, it } from "vitest";
import {
  launchLocalBrowser,
  localBrowserChromeFlags,
  WEBMCP_CHROME_FLAG,
} from "../../src/browser/localBrowser.js";

const CHROME_LAUNCHER_DEFAULT_FLAGS = [
  "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider," +
    "CalculateNativeWinOcclusion,InterestFeedContentSuggestions," +
    "CertificateTransparencyComponentUpdater,AutofillServerCommunication," +
    "PrivacySandboxSettings4,RenderDocument",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-sync",
  "--metrics-recording-only",
  "--disable-default-apps",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-ipc-flooding-protection",
  "--password-store=basic",
  "--use-mock-keychain",
  "--force-fieldtrials=*BackgroundTracing/default/",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-domain-reliability",
  "--propagate-iph-for-testing",
] as const;

const STAGEHAND_DEFAULT_FLAGS = [
  "--enable-unsafe-extension-debugging",
  "--remote-allow-origins=*",
  "--window-size=1280,800",
  WEBMCP_CHROME_FLAG,
] as const;

describe("local browser Chrome flags", () => {
  it("tracks chrome-launcher 1.2.1 defaults without disabling extensions", () => {
    expect(Launcher.defaultFlags()).toStrictEqual(CHROME_LAUNCHER_DEFAULT_FLAGS);

    const flags = localBrowserChromeFlags({}, Launcher.defaultFlags(), false);

    expect(flags).toStrictEqual([
      ...CHROME_LAUNCHER_DEFAULT_FLAGS.filter((flag) => flag !== "--disable-extensions"),
      ...STAGEHAND_DEFAULT_FLAGS,
    ]);
    expect(flags).not.toContain("--disable-extensions");
  });

  it("supports every option-driven Chrome flag and keeps caller arguments last", () => {
    const flags = localBrowserChromeFlags(
      {
        args: ["--lang=fr", "--custom-flag=value"],
        headless: true,
        devtools: true,
        chromiumSandbox: false,
        proxy: { server: "http://proxy.test:8080", bypass: "localhost" },
        locale: "de-CH",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        hasTouch: true,
        ignoreHTTPSErrors: true,
      },
      Launcher.defaultFlags(),
      false,
    );

    expect(flags).toEqual(
      expect.arrayContaining([
        "--window-size=1440,900",
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
    expect(flags.slice(-2)).toStrictEqual(["--lang=fr", "--custom-flag=value"]);
  });

  it("omits all implicit defaults while retaining explicitly requested behavior", () => {
    const flags = localBrowserChromeFlags(
      {
        ignoreDefaultArgs: true,
        viewport: { width: 1440, height: 900 },
        headless: true,
        args: ["--custom-flag"],
      },
      Launcher.defaultFlags(),
      false,
    );

    expect(flags).toStrictEqual(["--window-size=1440,900", "--headless", "--custom-flag"]);
    expect(flags).not.toContain(WEBMCP_CHROME_FLAG);
  });

  it("selectively omits Chrome and Stagehand defaults", () => {
    const ignoredChromeFlag = CHROME_LAUNCHER_DEFAULT_FLAGS[2];
    const flags = localBrowserChromeFlags(
      { ignoreDefaultArgs: [ignoredChromeFlag, WEBMCP_CHROME_FLAG] },
      Launcher.defaultFlags(),
      false,
    );

    expect(flags).not.toContain(ignoredChromeFlag);
    expect(flags).not.toContain(WEBMCP_CHROME_FLAG);
    expect(flags).toContain(CHROME_LAUNCHER_DEFAULT_FLAGS[0]);
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
        Launcher.defaultFlags(),
        false,
      ),
    ).toContain(windowSizeFlag);
  });

  it("allows the implicit viewport default to be selectively omitted", () => {
    expect(
      localBrowserChromeFlags(
        { ignoreDefaultArgs: ["--window-size=1280,800"] },
        Launcher.defaultFlags(),
        false,
      ),
    ).not.toContain("--window-size=1280,800");
  });

  it("disables the Chromium sandbox in CI", () => {
    expect(localBrowserChromeFlags({}, Launcher.defaultFlags(), true)).toContain("--no-sandbox");
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
