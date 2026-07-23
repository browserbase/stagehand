import { StagehandClientInitParamsSchema, type BrowserSource } from "./clientSchemas.js";
import { BrowserbaseSessionCreateParamsSchema } from "../../protocol/schemas.js";
import { LocalBrowserLaunchOptionsSchema } from "../../protocol/pending-schemas.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
  type BrowserbaseSessionClientFactory,
} from "./browserbaseSession.js";

export type { BrowserbaseSessionClient, BrowserbaseSessionClientFactory };

type LocalBrowserSource = Extract<BrowserSource, { type: "local" }>;
type LocalBrowserLaunchOptions = Omit<LocalBrowserSource, "type">;

export type ResolvedBrowserSource = {
  cdpUrl: string;
  cdpHeaders?: Record<string, string>;
  browserbaseSessionId?: string;
  preloadedExtension?: boolean;
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
      keepAlive: browser.keepAlive ?? false,
      close: session.close,
    };
  }

  if (browser.type === "local") {
    const launchOptions = LocalBrowserLaunchOptionsSchema.strip().parse(browser);
    const launched = await (dependencies.launchLocalBrowser ?? launchLocalBrowser)(launchOptions);
    return {
      cdpUrl: launched.cdpUrl,
      keepAlive: launchOptions.keepAlive ?? false,
      close: launched.close,
    };
  }

  return {
    cdpUrl: browser.cdpUrl,
    ...(browser.headers === undefined ? {} : { cdpHeaders: browser.headers }),
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
    chromeFlags: [
      ...Launcher.defaultFlags().filter((flag) => flag !== "--disable-extensions"),
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      ...(options.headless === true ? ["--headless"] : []),
      ...(options.devtools ? ["--auto-open-devtools-for-tabs"] : []),
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
    userDataDir: options.userDataDir,
    port: options.port,
    logLevel: "silent",
  });

  return {
    cdpUrl: `http://127.0.0.1:${chrome.port}`,
    close: () => chrome.kill(),
  };
}
