import type { StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseFetchOptionsSchema,
  BrowserbaseLaunchOptionsSchema,
  BrowserbaseSearchOptionsSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
} from "../clientSchemas.js";
import {
  claimStagehandBrowserHandle,
  createStagehandBrowserHandle,
  invalidateStagehandBrowserHandle,
  isStagehandBrowser,
  releaseStagehandBrowserHandle,
  type BrowserbaseBrowser,
  type LocalBrowser,
  type StagehandBrowser,
  type StagehandBrowserOrigin,
  type StagehandBrowserProvider,
} from "./index.js";
import { CDPClient, CDPConnectionClosedError, type CDPClientOptions } from "../cdpClient.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
} from "./browserbaseSession.js";
import {
  createBrowserbaseServicesClient,
  type BrowserbaseServicesClient,
} from "./browserbaseServices.js";
import { launchLocalBrowser, type LocalBrowserLauncher } from "./localBrowser.js";
import { STAGEHAND_EXTENSION_DIRECTORY_PATH } from "../extensionAssets.js";
import { abortable } from "../abort.js";
import { withStagehandInitDeadline } from "../timeouts.js";

export { isStagehandBrowser };
export type { BrowserbaseBrowser, LocalBrowser, StagehandBrowser } from "./index.js";

export type StagehandWorkerInitMetadata = Pick<StagehandInitParams, "apiKey" | "browser">;

export type ClaimedStagehandBrowser = {
  cdpClient: CDPClient;
  workerInitMetadata: StagehandWorkerInitMetadata;
};

type BrowserFactoryDependencies = {
  launchLocalBrowser?: LocalBrowserLauncher;
  createBrowserbaseSessionClient?: (apiKey: string, baseUrl: string) => BrowserbaseSessionClient;
  createBrowserbaseServicesClient?: (apiKey: string, baseUrl: string) => BrowserbaseServicesClient;
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
  const createBrowserbaseServices =
    dependencies.createBrowserbaseServicesClient ?? createBrowserbaseServicesClient;
  const connectCdp = dependencies.connectCdp ?? ((options) => CDPClient.connect(options));

  return {
    localBrowser: {
      async launch(input = {}) {
        const options = LocalBrowserLaunchOptionsSchema.parse(input);
        if (options.acceptDownloads === true && options.downloadsPath === undefined) {
          throw new Error("downloadsPath is required when acceptDownloads is true");
        }
        return await withStagehandInitDeadline(async (signal) => {
          const launchPromise = launchLocal(options, signal);
          let launched: Awaited<typeof launchPromise>;
          try {
            launched = await abortable(launchPromise, signal);
          } catch (error) {
            if (signal.aborted && options.keepAlive !== true) {
              // A launcher may finish after the deadline; close that late-owned browser.
              void launchPromise.then((lateBrowser) => lateBrowser.close()).catch(() => undefined);
            }
            throw error;
          }
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
            signal,
            afterConnect:
              options.acceptDownloads === undefined && options.downloadsPath === undefined
                ? undefined
                : async (cdpClient, commandSignal) => {
                    await cdpClient.sendCommand(
                      "Browser.setDownloadBehavior",
                      {
                        behavior: options.acceptDownloads === false ? "deny" : "allow",
                        ...(options.downloadsPath === undefined
                          ? {}
                          : { downloadPath: options.downloadsPath }),
                      },
                      undefined,
                      commandSignal,
                    );
                  },
            workerInitMetadata: {},
          });
        });
      },

      async connect(options) {
        const parsed = LocalBrowserConnectOptionsSchema.parse(options);
        const source: BrowserConnectionSource = {
          cdpUrl: parsed.cdpUrl,
          keepAlive: true,
        };
        return await withStagehandInitDeadline(async (signal) =>
          connectBrowser({
            provider: "local",
            origin: "connected",
            source,
            connectCdp,
            extension:
              parsed.extensionId === undefined
                ? { extensionDir: STAGEHAND_EXTENSION_DIRECTORY_PATH }
                : { extensionId: parsed.extensionId },
            signal,
            workerInitMetadata: {},
          }),
        );
      },
    },

    browserbase: {
      async launch(input) {
        const { apiKey, baseUrl, ...sessionOptions } = BrowserbaseLaunchOptionsSchema.parse(input);
        return await withStagehandInitDeadline(async (signal) => {
          const sessionPromise = createBrowserbase(apiKey, baseUrl).createSession(sessionOptions);
          let session: Awaited<typeof sessionPromise>;
          try {
            session = await abortable(sessionPromise, signal);
          } catch (error) {
            if (signal.aborted && sessionOptions.keepAlive !== true) {
              // A remote session may finish launching after the deadline; release it when owned.
              void sessionPromise
                .then((lateSession) => lateSession.close?.())
                .catch(() => undefined);
            }
            throw error;
          }
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
            signal,
            workerInitMetadata: {
              apiKey,
              browser: {
                sessionId: session.sessionId,
                ...(sessionOptions.region === undefined ? {} : { region: sessionOptions.region }),
              },
            },
          });
        });
      },

      async connect(input) {
        const options = BrowserbaseConnectOptionsSchema.parse(input);
        const client = createBrowserbase(options.apiKey, options.baseUrl);
        if (!client.connectSession) {
          throw new Error("Browserbase session connection is not supported by this client");
        }
        return await withStagehandInitDeadline(async (signal) => {
          const session = await abortable(client.connectSession!(options.sessionId), signal);
          const source: BrowserConnectionSource = {
            cdpUrl: session.cdpUrl,
            keepAlive: true,
            close: session.close,
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
            signal,
            workerInitMetadata: {
              apiKey: options.apiKey,
              browser: {
                sessionId: session.sessionId,
                ...(session.region === undefined ? {} : { region: session.region }),
              },
            },
          });
        });
      },

      async search(input) {
        const { apiKey, baseUrl, ...params } = BrowserbaseSearchOptionsSchema.parse(input);
        return await createBrowserbaseServices(apiKey, baseUrl).search(params);
      },

      async fetch(input) {
        const { apiKey, baseUrl, ...params } = BrowserbaseFetchOptionsSchema.parse(input);
        return await createBrowserbaseServices(apiKey, baseUrl).fetch(params);
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

/** @internal */
export function invalidateStagehandBrowser(browser: StagehandBrowser): Promise<void> {
  return invalidateStagehandBrowserHandle(browser);
}

async function connectBrowser(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  source: BrowserConnectionSource;
  connectCdp: (options: CDPClientOptions) => Promise<CDPClient>;
  extension: { extensionDir: string } | { extensionId: string } | { preloadedExtension: true };
  signal: AbortSignal;
  afterConnect?: (cdpClient: CDPClient, signal: AbortSignal) => Promise<void>;
  workerInitMetadata: StagehandWorkerInitMetadata;
}): Promise<StagehandBrowser> {
  const ownsSource = options.origin === "launched" && !options.source.keepAlive;
  let cdpClient: CDPClient | undefined;
  try {
    const connectionPromise = options.connectCdp({
      cdpUrl: options.source.cdpUrl,
      ...options.extension,
      serviceWorkerUrlIncludes: "service-worker.js",
      signal: options.signal,
    });
    try {
      cdpClient = await abortable(connectionPromise, options.signal);
    } catch (error) {
      if (options.signal.aborted) {
        // An injected connector may ignore AbortSignal and resolve after the factory rejects.
        void connectionPromise.then((lateClient) => lateClient.close()).catch(() => undefined);
      }
      throw error;
    }
    await options.afterConnect?.(cdpClient, options.signal);
    const connectedClient = cdpClient;
    const invalidate = async () => {
      connectedClient.close();
      if (ownsSource) {
        await closeSource(options.source);
      }
    };
    const close = async () => {
      try {
        if (options.provider === "local" && options.origin === "connected") {
          try {
            await connectedClient.sendCommand("Browser.close");
          } catch (error) {
            if (!(error instanceof CDPConnectionClosedError)) throw error;
          }
        } else {
          await closeSource(options.source);
        }
      } finally {
        connectedClient.close();
      }
    };
    return createStagehandBrowserHandle({
      provider: options.provider,
      origin: options.origin,
      sessionId: options.workerInitMetadata.browser?.sessionId,
      attachment: {
        cdpClient: connectedClient,
        workerInitMetadata: options.workerInitMetadata,
      } satisfies ClaimedStagehandBrowser,
      close,
      invalidate,
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
