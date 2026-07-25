import { LocalBrowserLaunchOptionsSchema } from "../../../../protocol/pending-schemas.js";
import type { LocalBrowserLaunchOptions } from "../../../../protocol/types.js";
import {
  resolveRemoteBrowserSource,
  type RemoteBrowserSourceResolverDependencies,
  type ResolvedBrowserSource,
} from "../../browserSource.shared.js";
import { StagehandClientInitParamsSchema } from "./clientSchemas.js";
import { launchLocalBrowser } from "./localBrowserLauncher.js";

export type {
  BrowserbaseSessionClient,
  BrowserbaseSessionClientFactory,
  ResolvedBrowserSource,
} from "../../browserSource.shared.js";

export type LocalBrowserLauncher = (
  options: LocalBrowserLaunchOptions,
) => Promise<{ cdpUrl: string; close: () => Promise<void> | void }>;

export type BrowserSourceResolverDependencies = RemoteBrowserSourceResolverDependencies & {
  launchLocalBrowser?: LocalBrowserLauncher;
};

export async function resolveBrowserSource(
  input: unknown,
  dependencies: BrowserSourceResolverDependencies = {},
): Promise<ResolvedBrowserSource> {
  const initParams = StagehandClientInitParamsSchema.parse(input);
  const browser = initParams.browser;

  if (browser.type === "local") {
    const launchOptions = LocalBrowserLaunchOptionsSchema.strip().parse(browser);
    const launched = await (dependencies.launchLocalBrowser ?? launchLocalBrowser)(launchOptions);
    return {
      cdpUrl: launched.cdpUrl,
      keepAlive: launchOptions.keepAlive ?? false,
      close: launched.close,
    };
  }

  return resolveRemoteBrowserSource(
    {
      ...(initParams.apiKey === undefined ? {} : { apiKey: initParams.apiKey }),
      browser,
    },
    dependencies,
  );
}
