import { z } from "zod/v4";
import { BrowserbaseSessionCreateParamsSchema } from "../../protocol/schemas.js";
import type {
  BrowserbaseSessionCreateParams,
  LocalBrowserLaunchOptions,
  StagehandInitParams,
} from "../../protocol/types.js";
import { CDPClient } from "../../sdk-ts/src/cdpClient.js";
import {
  createBrowserbaseSessionClient,
  type BrowserbaseSessionClient,
} from "../../sdk-ts/src/browserbaseSession.js";
import {
  resolveBrowserSource,
  type ResolvedBrowserSource,
} from "../../sdk-ts/src/browserSource.js";
import { STAGEHAND_EXTENSION_DIRECTORY_PATH } from "../../sdk-ts/src/extensionAssets.js";

const stagehandBrowserBrand: unique symbol = Symbol("StagehandBrowser");

export type StagehandBrowserProvider = "local" | "browserbase";
export type StagehandBrowserOrigin = "launched" | "connected";

export interface StagehandBrowser {
  readonly [stagehandBrowserBrand]: true;
  readonly provider: StagehandBrowserProvider;
  readonly origin: StagehandBrowserOrigin;
  readonly closed: boolean;
  close(): Promise<void>;
}

export type { LocalBrowserLaunchOptions } from "../../protocol/types.js";

export type LocalBrowserConnectOptions = {
  cdpUrl: string;
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
  extensionId?: string;
};

export type BrowserbaseLaunchOptions = BrowserbaseSessionCreateParams & {
  apiKey: string;
};

export type BrowserbaseConnectOptions = {
  apiKey: string;
  sessionId: string;
  connectTimeoutMs?: number;
};

export interface LocalBrowser {
  launch(options?: LocalBrowserLaunchOptions): Promise<StagehandBrowser>;
  connect(options: LocalBrowserConnectOptions): Promise<StagehandBrowser>;
}

export interface BrowserbaseBrowser {
  launch(options: BrowserbaseLaunchOptions): Promise<StagehandBrowser>;
  connect(options: BrowserbaseConnectOptions): Promise<StagehandBrowser>;
}

export type StagehandWorkerInitMetadata = Pick<StagehandInitParams, "apiKey" | "browser">;

export type ClaimedStagehandBrowser = {
  cdpClient: CDPClient;
  commandTimeoutMs: number;
  workerInitMetadata: StagehandWorkerInitMetadata;
};

type BrowserHandleInternals = ClaimedStagehandBrowser & {
  claimed: boolean;
  resourceClose?: () => Promise<void> | void;
  closePromise?: Promise<void>;
};

const browserHandleInternals = new WeakMap<StagehandBrowser, BrowserHandleInternals>();

class StagehandBrowserHandle implements StagehandBrowser {
  readonly [stagehandBrowserBrand] = true as const;

  constructor(
    readonly provider: StagehandBrowserProvider,
    readonly origin: StagehandBrowserOrigin,
    internals: BrowserHandleInternals,
  ) {
    browserHandleInternals.set(this, internals);
  }

  get closed(): boolean {
    return browserHandleInternals.get(this)?.closePromise !== undefined;
  }

  close(): Promise<void> {
    const internals = requireBrowserHandleInternals(this);
    internals.closePromise ??= (async () => {
      internals.cdpClient.close();
      await internals.resourceClose?.();
    })();
    return internals.closePromise;
  }
}

export function isStagehandBrowser(value: unknown): value is StagehandBrowser {
  return (
    typeof value === "object" &&
    value !== null &&
    browserHandleInternals.has(value as StagehandBrowser)
  );
}

export function claimStagehandBrowser(browser: StagehandBrowser): ClaimedStagehandBrowser {
  const internals = requireBrowserHandleInternals(browser);
  if (internals.closePromise) {
    throw new Error("Cannot attach Stagehand to a closed browser");
  }
  if (internals.claimed) {
    throw new Error("This browser is already attached to a Stagehand instance");
  }
  internals.claimed = true;
  return {
    cdpClient: internals.cdpClient,
    commandTimeoutMs: internals.commandTimeoutMs,
    workerInitMetadata: internals.workerInitMetadata,
  };
}

type BrowserFactoryDependencies = {
  resolveBrowserSource?: typeof resolveBrowserSource;
  createBrowserbaseSessionClient?: (apiKey: string) => BrowserbaseSessionClient;
  connectCdp?: typeof CDPClient.connect;
};

function createBrowserFactories(dependencies: BrowserFactoryDependencies = {}): {
  localBrowser: LocalBrowser;
  browserbase: BrowserbaseBrowser;
} {
  const resolveSource = dependencies.resolveBrowserSource ?? resolveBrowserSource;
  const connectCdp = dependencies.connectCdp ?? ((options) => CDPClient.connect(options));

  return {
    localBrowser: {
      async launch(options = {}) {
        if (options.acceptDownloads === true && options.downloadsPath === undefined) {
          throw new Error("downloadsPath is required when acceptDownloads is true");
        }
        const source = await resolveSource({ browser: { type: "local", ...options } });
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
        const source: ResolvedBrowserSource = {
          cdpUrl: parsed.cdpUrl,
          ...(parsed.headers === undefined ? {} : { cdpHeaders: parsed.headers }),
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
        const source = await resolveSource({
          apiKey,
          browser: { type: "browserbase", ...sessionOptions },
        });
        if (!source.browserbaseSessionId) {
          await closeSource(source);
          throw new Error("Browserbase session creation did not return a session ID");
        }
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
              type: "browserbase",
              ...sessionOptions,
              sessionId: source.browserbaseSessionId,
            },
          },
        });
      },

      async connect(input) {
        const options = BrowserbaseConnectOptionsSchema.parse(input);
        const client = (
          dependencies.createBrowserbaseSessionClient ?? createBrowserbaseSessionClient
        )(options.apiKey);
        if (!client.connectSession) {
          throw new Error("Browserbase session connection is not supported by this client");
        }
        const session = await client.connectSession(options.sessionId);
        const source: ResolvedBrowserSource = {
          cdpUrl: session.cdpUrl,
          browserbaseSessionId: session.sessionId,
          preloadedExtension: true,
          keepAlive: true,
        };
        return await connectBrowser({
          provider: "browserbase",
          origin: "connected",
          source,
          connectCdp,
          extension: { preloadedExtension: true },
          connectTimeoutMs: options.connectTimeoutMs,
          workerInitMetadata: {
            apiKey: options.apiKey,
            browser: {
              type: "browserbase",
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

export function createBrowserFactoriesForTest(
  dependencies: BrowserFactoryDependencies,
): ReturnType<typeof createBrowserFactories> {
  return createBrowserFactories(dependencies);
}

const LocalBrowserConnectOptionsSchema = z
  .object({
    cdpUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    connectTimeoutMs: z.number().int().positive().optional(),
    extensionId: z.string().min(1).optional(),
  })
  .strict();

const BrowserbaseLaunchOptionsSchema = BrowserbaseSessionCreateParamsSchema.extend({
  apiKey: z.string().min(1),
}).strict();

const BrowserbaseConnectOptionsSchema = z
  .object({
    apiKey: z.string().min(1),
    sessionId: z.string().min(1),
    connectTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

async function connectBrowser(options: {
  provider: StagehandBrowserProvider;
  origin: StagehandBrowserOrigin;
  source: ResolvedBrowserSource;
  connectCdp: typeof CDPClient.connect;
  extension: { extensionDir: string } | { extensionId: string } | { preloadedExtension: true };
  connectTimeoutMs: number | undefined;
  afterConnect?: (cdpClient: CDPClient) => Promise<void>;
  workerInitMetadata: StagehandWorkerInitMetadata;
}): Promise<StagehandBrowser> {
  const commandTimeoutMs = 10_000;
  let cdpClient: CDPClient | undefined;
  try {
    cdpClient = await options.connectCdp({
      cdpUrl: options.source.cdpUrl,
      ...(options.source.cdpHeaders === undefined ? {} : { cdpHeaders: options.source.cdpHeaders }),
      ...options.extension,
      serviceWorkerUrlIncludes: "service-worker.js",
      discoveryTimeoutMs: options.connectTimeoutMs ?? 10_000,
      cdpConnectTimeoutMs: options.connectTimeoutMs ?? 10_000,
      commandTimeoutMs,
    });
    await options.afterConnect?.(cdpClient);
    return new StagehandBrowserHandle(options.provider, options.origin, {
      cdpClient,
      commandTimeoutMs,
      workerInitMetadata: options.workerInitMetadata,
      claimed: false,
      ...(options.origin === "launched" && options.source.close
        ? { resourceClose: options.source.close }
        : {}),
    });
  } catch (error) {
    cdpClient?.close();
    if (options.origin === "launched") {
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

function requireBrowserHandleInternals(browser: StagehandBrowser): BrowserHandleInternals {
  const internals = browserHandleInternals.get(browser);
  if (!internals) {
    throw new TypeError("browser must be created by localBrowser or browserbase");
  }
  return internals;
}

async function closeSource(source: ResolvedBrowserSource): Promise<void> {
  await source.close?.();
}
