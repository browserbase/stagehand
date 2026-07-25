import { BrowserbaseSessionCreateParamsSchema } from "../../protocol/schemas.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
  type BrowserbaseSessionClientFactory,
} from "./browserbaseSession.js";

export type { BrowserbaseSessionClient, BrowserbaseSessionClientFactory };

export type ResolvedBrowserSource = {
  cdpUrl: string;
  cdpHeaders?: Record<string, string>;
  browserbaseSessionId?: string;
  keepAlive: boolean;
  close?: () => Promise<void> | void;
};

export type RemoteBrowserSourceResolverDependencies = {
  browserbase?: BrowserbaseSessionClient;
  createBrowserbaseSessionClient?: BrowserbaseSessionClientFactory;
};

type RemoteBrowserSourceInitParams = {
  apiKey?: string;
  browser:
    | {
        type: "browserbase";
        keepAlive?: boolean;
        [key: string]: unknown;
      }
    | {
        type: "cdp";
        cdpUrl: string;
        headers?: Record<string, string>;
      };
};

export async function resolveRemoteBrowserSource(
  initParams: RemoteBrowserSourceInitParams,
  dependencies: RemoteBrowserSourceResolverDependencies = {},
): Promise<ResolvedBrowserSource> {
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
      keepAlive: browser.keepAlive ?? false,
      close: session.close,
    };
  }

  return {
    cdpUrl: browser.cdpUrl,
    ...(browser.headers === undefined ? {} : { cdpHeaders: browser.headers }),
    keepAlive: true,
  };
}
