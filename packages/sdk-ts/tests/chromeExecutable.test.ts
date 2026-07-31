import { describe, expect, it } from "vitest";
import { chromeExecutableCandidates, findChromeExecutable } from "../src/chromeExecutable.js";

describe("Chrome executable discovery", () => {
  it("orders macOS system and user installations by release channel", () => {
    const candidates = chromeExecutableCandidates("darwin", {}, "/Users/tester");

    expect(candidates).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Users/tester/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
      "/Users/tester/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Users/tester/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Users/tester/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  });

  it("orders Windows installations by release channel across known roots", () => {
    const candidates = chromeExecutableCandidates(
      "win32",
      {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PROGRAMFILES: "C:\\Program Files",
      },
      "C:\\Users\\tester",
    );

    expect(candidates.slice(0, 6)).toEqual([
      "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome Beta\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe",
      "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome Dev\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe",
    ]);
    expect(candidates).toContain(
      "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe",
    );
  });

  it("searches Linux PATH in release-channel order", () => {
    const candidates = chromeExecutableCandidates(
      "linux",
      { PATH: "/opt/bin:/usr/bin" },
      "/home/tester",
    );

    expect(candidates.slice(0, 6)).toEqual([
      "/opt/bin/google-chrome-stable",
      "/usr/bin/google-chrome-stable",
      "/opt/bin/google-chrome",
      "/usr/bin/google-chrome",
      "/opt/bin/google-chrome-beta",
      "/usr/bin/google-chrome-beta",
    ]);
  });

  it("prefers a valid CHROME_PATH", () => {
    expect(
      findChromeExecutable({
        platform: "linux",
        env: { CHROME_PATH: "/custom/chrome", PATH: "/usr/bin" },
        isExecutable: (candidate) => candidate === "/custom/chrome",
      }),
    ).toBe("/custom/chrome");
  });

  it.each([
    ["Chrome Dev", "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"],
    ["Chrome Canary", "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"],
    ["Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  ])("falls back to an installation containing only %s", (_name, installed) => {
    expect(
      findChromeExecutable({
        platform: "darwin",
        env: {},
        homeDirectory: "/Users/tester",
        isExecutable: (candidate) => candidate === installed,
      }),
    ).toBe(installed);
  });

  it("skips an invalid CHROME_PATH and prefers stable among installed channels", () => {
    const stable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const canary = "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";

    expect(
      findChromeExecutable({
        platform: "darwin",
        env: { CHROME_PATH: "/missing/chrome" },
        homeDirectory: "/Users/tester",
        isExecutable: (candidate) => candidate === stable || candidate === canary,
      }),
    ).toBe(stable);
  });

  it("accepts Windows Chrome discovered through chrome-launcher's WSL support", () => {
    const windowsChrome = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

    expect(
      findChromeExecutable({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        isExecutable: (candidate) => candidate === windowsChrome,
        legacyInstallations: () => [windowsChrome],
      }),
    ).toBe(windowsChrome);
  });

  it("accepts a macOS installation discovered through Launch Services", () => {
    const registeredChrome =
      "/Enterprise/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

    expect(
      findChromeExecutable({
        platform: "darwin",
        env: {},
        homeDirectory: "/Users/tester",
        isExecutable: (candidate) => candidate === registeredChrome,
        legacyInstallations: () => [registeredChrome],
      }),
    ).toBe(registeredChrome);
  });

  it("accepts a Linux chrome-wrapper discovered through desktop entries", () => {
    const chromeWrapper = "/opt/google/chrome-wrapper";

    expect(
      findChromeExecutable({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        isExecutable: (candidate) => candidate === chromeWrapper,
        legacyInstallations: () => [chromeWrapper],
      }),
    ).toBe(chromeWrapper);
  });

  it("applies Stagehand channel order to legacy discoveries", () => {
    const stable = "/Users/dev/custom/Google Chrome.app/Contents/MacOS/Google Chrome";
    const canary = "/custom/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";

    expect(
      findChromeExecutable({
        platform: "darwin",
        env: {},
        homeDirectory: "/Users/tester",
        isExecutable: (candidate) => candidate === stable || candidate === canary,
        legacyInstallations: () => [canary, stable],
      }),
    ).toBe(stable);
  });

  it("throws a Stagehand-specific error when no browser is found", () => {
    expect(() =>
      findChromeExecutable({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        isExecutable: () => false,
      }),
    ).toThrow(/Chrome Stable, Beta, Dev, Canary, and Chromium.*executablePath.*CHROME_PATH/u);
  });
});
