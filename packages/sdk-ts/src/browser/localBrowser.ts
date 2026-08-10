import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LocalBrowserLaunchOptions } from "../clientSchemas.js";

export const WEBMCP_CHROME_FLAG = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport";

const STAGEHAND_DEFAULT_CHROME_FLAGS = [
  "--enable-unsafe-extension-debugging",
  "--remote-allow-origins=*",
] as const;

export type LocalBrowserLauncher = (
  options: LocalBrowserLaunchOptions,
) => Promise<{ cdpUrl: string; close: () => Promise<void> | void }>;

export const launchLocalBrowser: LocalBrowserLauncher = async (options) => {
  if (options.proxy?.username !== undefined || options.proxy?.password !== undefined) {
    throw new Error("Authenticated local browser proxies are not supported yet");
  }
  const { getChromePath, launch, Launcher } = await import("chrome-launcher");
  const userDataDir =
    options.userDataDir ??
    (options.preserveUserDataDir === true
      ? await mkdtemp(path.join(tmpdir(), "stagehand-chrome-"))
      : undefined);
  const chrome = await launch({
    chromePath: options.executablePath ?? getChromePath(),
    startingUrl: "about:blank",
    ignoreDefaultFlags: true,
    chromeFlags: localBrowserChromeFlags(options, Launcher.defaultFlags(), Boolean(process.env.CI)),
    userDataDir,
    ...(options.port === undefined ? {} : { port: options.port }),
    logLevel: "silent",
  });

  return {
    cdpUrl: `http://127.0.0.1:${chrome.port}`,
    close: () => chrome.kill(),
  };
};

export function localBrowserChromeFlags(
  options: LocalBrowserLaunchOptions,
  launcherDefaultFlags: string[],
  isCI: boolean,
): string[] {
  const ignoredDefaultArgs = options.ignoreDefaultArgs;
  const ignoredFlags = new Set(Array.isArray(ignoredDefaultArgs) ? ignoredDefaultArgs : []);
  const includeDefaults = ignoredDefaultArgs !== true;
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const windowSizeFlag = `--window-size=${viewport.width},${viewport.height}`;

  // The browser factory installs the packaged runtime through CDP after launch.
  // Branded Chrome ignores --load-extension, so do not claim it is preloaded here.
  return [
    ...(includeDefaults
      ? launcherDefaultFlags.filter(
          (flag) => flag !== "--disable-extensions" && !ignoredFlags.has(flag),
        )
      : []),
    ...(includeDefaults
      ? STAGEHAND_DEFAULT_CHROME_FLAGS.filter((flag) => !ignoredFlags.has(flag))
      : []),
    ...(options.viewport !== undefined || (includeDefaults && !ignoredFlags.has(windowSizeFlag))
      ? [windowSizeFlag]
      : []),
    ...(includeDefaults && !ignoredFlags.has(WEBMCP_CHROME_FLAG) ? [WEBMCP_CHROME_FLAG] : []),
    ...(options.headless === true ? ["--headless"] : []),
    ...(options.devtools ? ["--auto-open-devtools-for-tabs"] : []),
    ...(isCI || options.chromiumSandbox === false ? ["--no-sandbox"] : []),
    ...(options.proxy ? [`--proxy-server=${options.proxy.server}`] : []),
    ...(options.proxy?.bypass ? [`--proxy-bypass-list=${options.proxy.bypass}`] : []),
    ...(options.locale ? [`--lang=${options.locale}`] : []),
    ...(options.deviceScaleFactor === undefined
      ? []
      : [`--force-device-scale-factor=${options.deviceScaleFactor}`]),
    ...(options.hasTouch === true ? ["--touch-events=enabled"] : []),
    ...(options.ignoreHTTPSErrors === true ? ["--ignore-certificate-errors"] : []),
    ...(options.args ?? []),
  ];
}
