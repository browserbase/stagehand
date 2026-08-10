import { describe, expect, it } from "vitest";
import { localBrowserChromeFlags, WEBMCP_CHROME_FLAG } from "../../src/browser/localBrowser.js";

describe("localBrowserChromeFlags", () => {
  const launcherDefaults = ["--disable-extensions", "--disable-background-networking"];

  it("keeps extensions enabled for CDP installation without launch-time loading", () => {
    expect(localBrowserChromeFlags({}, launcherDefaults, false)).toEqual([
      "--disable-background-networking",
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      WEBMCP_CHROME_FLAG,
    ]);
  });

  it("does not inject extension flags when default browser flags are disabled", () => {
    expect(
      localBrowserChromeFlags(
        { ignoreDefaultArgs: true, args: ["--user-supplied"] },
        launcherDefaults,
        false,
      ),
    ).toEqual(["--user-supplied"]);
  });

  it("preserves headless and launch options", () => {
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
