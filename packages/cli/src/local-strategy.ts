export type LocalStrategy = "auto" | "isolated" | "cdp";

export interface LocalConfig {
  strategy: LocalStrategy;
  cdpTarget?: string;
}

export interface LocalInfo {
  localSource:
    | "attached-existing"
    | "attached-explicit"
    | "isolated"
    | "isolated-fallback";
  resolvedCdpUrl?: string;
  fallbackReason?: string;
}

export interface LocalBrowserLaunchOptions {
  cdpUrl?: string;
  headless?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface LocalCdpDiscovery {
  wsUrl: string;
  source: string;
}

interface ResolveLocalStrategyOptions {
  localConfig: LocalConfig;
  headless: boolean;
  defaultViewport: {
    width: number;
    height: number;
  };
  discoverLocalCdp: () => Promise<LocalCdpDiscovery | null>;
  resolveWsTarget: (input: string) => Promise<string>;
}

export interface ResolvedLocalStrategy {
  localLaunchOptions: LocalBrowserLaunchOptions;
  localInfo: LocalInfo;
}

export const DEFAULT_LOCAL_CONFIG: LocalConfig = { strategy: "isolated" };

export async function resolveLocalStrategy({
  localConfig,
  headless,
  defaultViewport,
  discoverLocalCdp,
  resolveWsTarget,
}: ResolveLocalStrategyOptions): Promise<ResolvedLocalStrategy> {
  if (localConfig.strategy === "isolated") {
    return {
      localLaunchOptions: { headless, viewport: defaultViewport },
      localInfo: { localSource: "isolated" },
    };
  }

  if (localConfig.strategy === "cdp") {
    if (!localConfig.cdpTarget) {
      throw new Error("Local CDP strategy requires a cdpTarget");
    }

    const cdpUrl = await resolveWsTarget(localConfig.cdpTarget);
    return {
      localLaunchOptions: { cdpUrl },
      localInfo: {
        localSource: "attached-explicit",
        resolvedCdpUrl: cdpUrl,
      },
    };
  }

  const discovered = await discoverLocalCdp();
  if (discovered) {
    return {
      localLaunchOptions: { cdpUrl: discovered.wsUrl },
      localInfo: {
        localSource: "attached-existing",
        resolvedCdpUrl: discovered.wsUrl,
      },
    };
  }

  return {
    localLaunchOptions: { headless, viewport: defaultViewport },
    localInfo: {
      localSource: "isolated-fallback",
      fallbackReason: "no debuggable local browser found",
    },
  };
}
