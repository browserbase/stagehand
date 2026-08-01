import type {
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
} from "../clientSchemas.js";

export type {
  BrowserbaseConnectOptions,
  BrowserbaseLaunchOptions,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
};

declare const stagehandBrowserBrand: unique symbol;

export type StagehandBrowserProvider = "local" | "browserbase";
export type StagehandBrowserOrigin = "launched" | "connected";

/**
 * A browser whose Stagehand extension is ready for its first RPC call.
 *
 * Browser handles are created by Stagehand's browser factories. The private
 * brand prevents arbitrary CDP connections from being passed to Stagehand.
 */
export interface StagehandBrowser {
  readonly [stagehandBrowserBrand]: true;
  readonly provider: StagehandBrowserProvider;
  readonly origin: StagehandBrowserOrigin;
  readonly closed: boolean;
  close(): Promise<void>;
}

export interface LocalBrowser {
  launch(options?: LocalBrowserLaunchOptions): Promise<StagehandBrowser>;
  connect(options: LocalBrowserConnectOptions): Promise<StagehandBrowser>;
}

export interface BrowserbaseBrowser {
  launch(options: BrowserbaseLaunchOptions): Promise<StagehandBrowser>;
  connect(options: BrowserbaseConnectOptions): Promise<StagehandBrowser>;
}
