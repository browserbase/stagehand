import {
  LocalBrowserLaunchOptionsSchema,
  StagehandClientInitParamsSchema,
} from "./clientSchemas.js";
import { BrowserbaseSessionCreateParamsSchema } from "../../protocol/schemas.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
  type BrowserbaseSessionClientFactory,
} from "./browser/browserbaseSession.js";
import { launchLocalBrowser, type LocalBrowserLauncher } from "./browser/localBrowser.js";

export type { BrowserbaseSessionClient, BrowserbaseSessionClientFactory };
export { localBrowserChromeFlags, WEBMCP_CHROME_FLAG } from "./browser/localBrowser.js";

export type ResolvedBrowserSource = {
  cdpUrl: string;
  cdpHeaders?: Record<string, string>;
  browserbaseSessionId?: string;
  preloadedExtension?: boolean;
  residentBrowserConnection?: boolean;
  keepAlive: boolean;
  close?: () => Promise<void> | void;
};

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
      residentBrowserConnection: false,
      keepAlive: browser.keepAlive ?? false,
      close: session.close,
    };
  }

  if (browser.type === "local") {
    const { type: _, ...localOptions } = browser;
    const launchOptions = LocalBrowserLaunchOptionsSchema.parse(localOptions);
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
