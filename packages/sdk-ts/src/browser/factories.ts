import type { StagehandInitParams } from "../../../protocol/types.js";
import {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseLaunchOptionsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
} from "../clientSchemas.js";
import {
  claimStagehandBrowserHandle,
  createStagehandBrowserHandle,
  isStagehandBrowser,
  releaseStagehandBrowserHandle,
  type BrowserbaseBrowser,
  type LocalBrowser,
  type StagehandBrowser,
  type StagehandBrowserOrigin,
  type StagehandBrowserProvider,
} from "./index.js";
import { CDPClient, type CDPClientOptions } from "../cdpClient.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
} from "./browserbaseSession.js";
import { launchLocalBrowser, type LocalBrowserLauncher } from "./localBrowser.js";
import { STAGEHAND_EXTENSION_DIRECTORY_PATH } from "../extensionAssets.js";

export { isStagehandBrowser };
export type { BrowserbaseBrowser, LocalBrowser, StagehandBrowser } from "./index.js";

export type StagehandWorkerInitMetadata = Pick<StagehandInitParams, "apiKey" | "browser">;

export type ClaimedStagehandBrowser = {
  cdpClient: CDPClient;
  commandTimeoutMs: number;
  workerInitMetadata: StagehandWorkerInitMetadata;
};

type BrowserFactoryDependencies = {
  launchLocalBrowser?: LocalBrowserLauncher;
  createBrowserbaseSessionClient?: (apiKey: string) => BrowserbaseSessionClient;
  connectCdp?: (options: CDPClientOptions) => Promise<CDPClient>;
};

type BrowserConnectionSource = {
  cdpUrl: string;
  keepAlive: boolean;
  close?: () => Promise<void> | void;
};

function createBrowserFactories(dependencies: BrowserFactoryDependencies = {}): {
  localBrowser: LocalBrowser;
  browserbase: BrowserbaseBrowser;
} {
  const launchLocal = dependencies.launchLocalBrowser ?? launchLocalBrowser;
  const createBrowserbase =
    dependencies.createBrowserbaseSessionClient ?? createBrowserbaseSessionClient;
  const connectCdp = dependencies.connectCdp ?? ((options) => CDPClient.connect(options));

  return {
    localBrowser: {
      async launch(input = {}) {
        const options = LocalBrowserLaunchOptionsSchema.parse(input);
        if (options.acceptDownloads === true && options.downloadsPath === undefined) {
          throw new Error("downloadsPath is required when acceptDownloads is true");
        }
        const launched = await launchLocal(options);
        const source: BrowserConnectionSource = {
          cdpUrl: launched.cdpUrl,
          keepAlive: options.keepAlive ?? false,
          close: launched.close,
        };
        return await connectBrowser({
          provider: "local",
          origin: "launched",
          source,
          connectCdp,
          extension: { extensionDir: STAGEHAND_EXTENSION_DIRECTORY_PATH },
          connectTimeoutMs: options.connectTimeoutMs,
          afterConnect:
            options.acceptDownloads === undefined && options.downloadsPath === undefined
              ? undefined
              : async (cdpClient) => {
                  await cdpClient.sendCommand("Browser.setDownloadBehavior", {
                    behavior: options.acceptDownloads === false ? "deny" : "allow",
                    ...(options.downloadsPath === undefined
                      ? {}
                      : { downloadPath: options.downloadsPath }),
                  });
                },
          workerInitMetadata: {},
        });
      },

      async connect(options) {
        const parsed = LocalBrowserConnectOptionsSchema.parse(options);
        const source: BrowserConnectionSource = {
          cdpUrl: parsed.cdpUrl,
          keepAlive: true,
        };
        return await connectBrowser({
          provider: "local",
          origin: "connected",
          source,
          connectCdp,
          extension:
            parsed.extensionId === undefined
              ? { extensionDir: STAGEHAND_EXTENSION_DIRECTORY_PATH }
              : { extensionId: parsed.extensionId },
          connectTimeoutMs: parsed.connectTimeoutMs,
          workerInitMetadata: {},
        });
      },
    },

    browserbase: {
      async launch(input) {
        const { apiKey, ...sessionOptions } = BrowserbaseLaunchOptionsSchema.parse(input);
        const session = await createBrowserbase(apiKey).createSession(sessionOptions);
        const source: BrowserConnectionSource = {
          cdpUrl: session.cdpUrl,
          keepAlive: sessionOptions.keepAlive ?? false,
          close: session.close,
        };
        return await connectBrowser({
          provider: "browserbase",
          origin: "launched",
          source,
          connectCdp,
          extension: { preloadedExtension: true },
          connectTimeoutMs: undefined,
          workerInitMetadata: {
            apiKey,
            browser: {
              sessionId: session.sessionId,
              ...(sessionOptions.region === undefined ? {} : { region: sessionOptions.region }),
            },
          },
        });
      },

      async connect(input) {
        const options = BrowserbaseConnectOptionsSchema.parse(input);
        const client = createBrowserbase(options.apiKey);
        if (!client.connectSession) {
          throw new Error("Browserbase session connection is not supported by this client");
        }
        const session = await client.connectSession(options.sessionId);
        const source: BrowserConnectionSource = {
          cdpUrl: session.cdpUrl,
          keepAlive: true,
        };
        return await connectBrowser({
          provider: "browserbase",
          origin: "connected",
          source,
          connectCdp,
          extension:
            options.extensionId === undefined
              ? { preloadedExtension: true }
              : { extensionId: options.extensionId },
          connectTimeoutMs: options.connectTimeoutMs,
          workerInitMetadata: {
            apiKey: options.apiKey,
            browser: {
              sessionId: session.sessionId,
              ...(session.region === undefined ? {} : { region: session.region }),
            },
          },
        });
      },
    },
  };
}

const factories = createBrowserFactories();
export const localBrowser = factories.localBrowser;
export const browserbase = factories.browserbase;

/** @internal */
export function createBrowserFactoriesForTest(
  dependencies: BrowserFactoryDependencies,
): ReturnType<typeof createBrowserFactories> {
  return createBrowserFactories(dependencies);
}

/** @internal */
export function claimStagehandBrowser(browser: StagehandBrowser): ClaimedStagehandBrowser {
  return claimStagehandBrowserHandle<ClaimedStagehandBrowser>(browser);
}

/** @internal */
export function releaseStagehandBrowser(browser: StagehandBrowser): void {
  releaseStagehandBrowserHandle(browser);
}

async function connectBrowser(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  source: BrowserConnectionSource;
  connectCdp: (options: CDPClientOptions) => Promise<CDPClient>;
  extension: { extensionDir: string } | { extensionId: string } | { preloadedExtension: true };
  connectTimeoutMs: number | undefined;
  afterConnect?: (cdpClient: CDPClient) => Promise<void>;
  workerInitMetadata: StagehandWorkerInitMetadata;
}): Promise<StagehandBrowser> {
  const commandTimeoutMs = 10_000;
  const ownsSource = options.origin === "launched" && !options.source.keepAlive;
  let cdpClient: CDPClient | undefined;
  try {
    cdpClient = await options.connectCdp({
      cdpUrl: options.source.cdpUrl,
      ...options.extension,
      serviceWorkerUrlIncludes: "service-worker.js",
      discoveryTimeoutMs: options.connectTimeoutMs ?? 10_000,
      cdpConnectTimeoutMs: options.connectTimeoutMs ?? 10_000,
      commandTimeoutMs,
    });
    await options.afterConnect?.(cdpClient);
    const connectedClient = cdpClient;
    return createStagehandBrowserHandle({
      provider: options.provider,
      origin: options.origin,
      attachment: {
        cdpClient: connectedClient,
        commandTimeoutMs,
        workerInitMetadata: options.workerInitMetadata,
      } satisfies ClaimedStagehandBrowser,
      close: async () => {
        connectedClient.close();
        if (ownsSource) {
          await closeSource(options.source);
        }
      },
    });
  } catch (error) {
    cdpClient?.close();
    if (ownsSource) {
      try {
        await closeSource(options.source);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Browser connection failed and browser cleanup also failed",
          { cause: error },
        );
      }
    }
    throw error;
  }
}

async function closeSource(source: BrowserConnectionSource): Promise<void> {
  await source.close?.();
}
