import { StagehandClientInitParamsSchema, type BrowserSource } from "./clientSchemas.js";
import {
  BrowserbaseSessionCreateParamsSchema,
  LocalBrowserLaunchOptionsSchema,
} from "../../protocol/schemas.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
  type BrowserbaseSessionClientFactory,
} from "./browserbaseSession.js";

export type { BrowserbaseSessionClient, BrowserbaseSessionClientFactory };

type LocalBrowserSource = Extract<BrowserSource, { type: "local" }>;
type LocalBrowserLaunchOptions = Omit<LocalBrowserSource, "type">;

export const WEBMCP_CHROME_FLAG = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport";

const STAGEHAND_DEFAULT_CHROME_FLAGS = [
  "--enable-unsafe-extension-debugging",
  "--remote-allow-origins=*",
  "--window-size=1280,800",
  WEBMCP_CHROME_FLAG,
] as const;

export type ResolvedBrowserSource = {
  cdpUrl: string;
  cdpHeaders?: Record<string, string>;
  browserbaseSessionId?: string;
  preloadedExtension?: boolean;
  residentBrowserConnection?: boolean;
  keepAlive: boolean;
  close?: () => Promise<void> | void;
};

export type LocalBrowserLauncher = (
  options: LocalBrowserLaunchOptions,
) => Promise<{ cdpUrl: string; close: () => Promise<void> | void }>;

export type BrowserSourceResolverDependencies = {
  launchLocalBrowser?: LocalBrowserLauncher;
  browserbase?: BrowserbaseSessionClient;
  createBrowserbaseSessionClient?: BrowserbaseSessionClientFactory;
};

export async function resolveBrowserSource(
  input: unknown,
  dependencies: BrowserSourceResolverDependencies = {},
): Promise<ResolvedBrowserSource> {
  const initParams = StagehandClientInitParamsSchema.parse(input);
  const browser = initParams.browser;

  if (browser.type === "browserbase") {
    const apiKey = initParams.apiKey;
    if (apiKey === undefined) {
      throw new Error("A Browserbase API key is required for the Browserbase browser source");
    }
    const sessionCreateParams = BrowserbaseSessionCreateParamsSchema.strip().parse(browser);
    const browserbase =
      dependencies.browserbase ??
      (dependencies.createBrowserbaseSessionClient ?? createBrowserbaseSessionClient)(apiKey);
    const session = await browserbase.createSession(sessionCreateParams);
    return {
      cdpUrl: session.cdpUrl,
      browserbaseSessionId: session.sessionId,
      preloadedExtension: true,
      residentBrowserConnection: true,
      keepAlive: browser.keepAlive ?? false,
      close: session.close,
    };
  }

  if (browser.type === "local") {
    const launchOptions = LocalBrowserLaunchOptionsSchema.strip().parse(browser);
    const launched = await (dependencies.launchLocalBrowser ?? launchLocalBrowser)(launchOptions);
    return {
      cdpUrl: launched.cdpUrl,
      residentBrowserConnection: false,
      keepAlive: launchOptions.keepAlive ?? false,
      close: launched.close,
    };
  }

  return {
    cdpUrl: browser.cdpUrl,
    ...(browser.headers === undefined ? {} : { cdpHeaders: browser.headers }),
    residentBrowserConnection: false,
    keepAlive: true,
  };
}

async function launchLocalBrowser(
  options: LocalBrowserLaunchOptions,
): Promise<{ cdpUrl: string; close: () => void }> {
  const { getChromePath, launch, Launcher } = await import("chrome-launcher");
  const chrome = await launch({
    chromePath: getChromePath(),
    startingUrl: "about:blank",
    ignoreDefaultFlags: true,
    chromeFlags: localBrowserChromeFlags(options, Launcher.defaultFlags(), Boolean(process.env.CI)),
    userDataDir: options.userDataDir,
    ...(options.port === undefined ? {} : { port: options.port }),
    logLevel: "silent",
  });

  return {
    cdpUrl: `http://127.0.0.1:${chrome.port}`,
    close: () => chrome.kill(),
  };
}

export function localBrowserChromeFlags(
  options: LocalBrowserLaunchOptions,
  launcherDefaultFlags: string[],
  isCI: boolean,
): string[] {
  const ignoredDefaultArgs = options.ignoreDefaultArgs;
  const ignoredFlags = new Set(Array.isArray(ignoredDefaultArgs) ? ignoredDefaultArgs : []);
  const includeDefaults = ignoredDefaultArgs !== true;

  return [
    ...(includeDefaults
      ? launcherDefaultFlags.filter(
          (flag) => flag !== "--disable-extensions" && !ignoredFlags.has(flag),
        )
      : []),
    ...(includeDefaults
      ? STAGEHAND_DEFAULT_CHROME_FLAGS.filter((flag) => !ignoredFlags.has(flag))
      : []),
    ...(options.headless === true ? ["--headless"] : []),
    ...(options.devtools ? ["--auto-open-devtools-for-tabs"] : []),
    ...(isCI ? ["--no-sandbox"] : []),
    ...(options.args ?? []),
  ];
}
