import { StagehandOptionsSchema } from "../../protocol/pending-schemas.js";
import type { StagehandOptions } from "../../protocol/types.js";

type LocalBrowserLaunchOptions = NonNullable<StagehandOptions["localBrowserLaunchOptions"]>;
type BrowserbaseSessionCreateParams = NonNullable<
  StagehandOptions["browserbaseSessionCreateParams"]
>;
type BrowserbaseConnectOptions = NonNullable<StagehandOptions["browserbaseConnectOptions"]>;

export type ResolvedBrowserSource = {
  cdpUrl: string;
  keepAlive: boolean;
  close?: () => Promise<void> | void;
};

export type LocalBrowserLauncher = (
  options: LocalBrowserLaunchOptions,
) => Promise<{ cdpUrl: string; close: () => Promise<void> | void }>;

export type BrowserbaseSessionClient = {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ cdpUrl: string; close?: () => Promise<void> | void }>;
  connectToSession(
    options: BrowserbaseConnectOptions & { sessionId: string },
  ): Promise<{ cdpUrl: string; close?: () => Promise<void> | void }>;
};

export type BrowserSourceResolverDependencies = {
  launchLocalBrowser?: LocalBrowserLauncher;
  browserbase?: BrowserbaseSessionClient;
};

export async function resolveBrowserSource(
  input: unknown,
  dependencies: BrowserSourceResolverDependencies = {},
): Promise<ResolvedBrowserSource> {
  const options = StagehandOptionsSchema.parse(input);

  if (options.localBrowserLaunchOptions) {
    const launched = await (dependencies.launchLocalBrowser ?? launchLocalBrowser)(
      options.localBrowserLaunchOptions,
    );
    return {
      cdpUrl: launched.cdpUrl,
      keepAlive: options.localBrowserLaunchOptions.keepAlive ?? false,
      close: launched.close,
    };
  }

  if (options.localBrowserConnectOptions) {
    return {
      cdpUrl: options.localBrowserConnectOptions.cdpUrl,
      keepAlive: options.localBrowserConnectOptions.keepAlive ?? true,
    };
  }

  if (options.browserbaseSessionCreateParams) {
    const browserbase = dependencies.browserbase ?? defaultBrowserbaseSessionClient;
    const session = await browserbase.createSession(options.browserbaseSessionCreateParams);
    return {
      cdpUrl: session.cdpUrl,
      keepAlive: options.browserbaseSessionCreateParams.keepAlive ?? false,
      close: session.close,
    };
  }

  if (options.browserbaseConnectOptions) {
    if (options.browserbaseConnectOptions.cdpUrl) {
      return {
        cdpUrl: options.browserbaseConnectOptions.cdpUrl,
        keepAlive: options.browserbaseConnectOptions.keepAlive ?? true,
      };
    }

    const { sessionId } = options.browserbaseConnectOptions;
    if (!sessionId) {
      throw new Error("Browserbase connect options must include a session ID or CDP URL");
    }

    const browserbase = dependencies.browserbase ?? defaultBrowserbaseSessionClient;
    const session = await browserbase.connectToSession({
      ...options.browserbaseConnectOptions,
      sessionId,
    });
    return {
      cdpUrl: session.cdpUrl,
      keepAlive: options.browserbaseConnectOptions.keepAlive ?? true,
      close: session.close,
    };
  }

  throw new Error("No browser source option was provided");
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

const defaultBrowserbaseSessionClient: BrowserbaseSessionClient = {
  async createSession() {
    throw new Error("Browserbase session creation is not implemented yet");
  },
  async connectToSession() {
    throw new Error("Browserbase session lookup is not implemented yet");
  },
};
