import type { BrowserbaseSessionCreateParams } from "../../../protocol/types.js";
import {
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
  type ProvisionedBrowserbaseExtension,
} from "../browserbaseExtension.js";
import {
  createBrowserbaseApiClient,
  type BrowserbaseApiClient,
  type BrowserbaseApiClientOptions,
} from "../browserbaseClient.js";
import { STAGEHAND_SESSION_METADATA } from "../sdkIdentity.js";
import {
  BrowserbaseSessionConnectionSchema,
  type BrowserbaseSessionConnection,
} from "../clientSchemas.js";

type OwnedBrowserbaseSession = BrowserbaseSessionConnection & {
  close?: () => Promise<void> | void;
};

export type BrowserbaseSessionClient = {
  createSession(params: BrowserbaseSessionCreateParams): Promise<OwnedBrowserbaseSession>;
  connectSession?(sessionId: string): Promise<BrowserbaseSessionConnection>;
};

export type BrowserbaseSessionClientFactory = (apiKey: string) => BrowserbaseSessionClient;

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
  browserbaseApi?: BrowserbaseApiClientOptions;
  provisionExtension?: (
    client: BrowserbaseExtensionClient,
  ) => Promise<ProvisionedBrowserbaseExtension>;
};

export class BrowserbaseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserbaseSessionError";
  }
}

export function createBrowserbaseSessionClient(
  apiKey: string,
  dependencies: BrowserbaseSessionClientDependencies = {},
): BrowserbaseSessionClient {
  const browserbase =
    dependencies.browserbase ?? createBrowserbaseApiClient(apiKey, dependencies.browserbaseApi);
  const provisionExtension = dependencies.provisionExtension ?? provisionBrowserbaseExtension;

  return {
    async createSession(params) {
      const callerExtensionId = params.extensionId ?? params.browserSettings?.extensionId;
      const extension =
        callerExtensionId === undefined ? await provisionExtension(browserbase) : undefined;
      let session: Awaited<ReturnType<BrowserbaseApiClient["createSession"]>>;

      try {
        session = await browserbase.createSession({
          ...params,
          ...(extension === undefined ? {} : { extensionId: extension.extensionId }),
          userMetadata: {
            ...params.userMetadata,
            ...STAGEHAND_SESSION_METADATA,
          },
        });
      } catch {
        await extension?.cleanup().catch(() => undefined);
        throw new BrowserbaseSessionError("Failed to create a Browserbase session");
      }

      const sessionId = session.id.trim();
      const cdpUrl = session.connectUrl.trim();
      if (sessionId.length === 0 || cdpUrl.length === 0) {
        await cleanupInvalidSession(browserbase, sessionId, extension);
        throw new Error(
          sessionId.length === 0
            ? "Browserbase session creation returned an empty session ID"
            : "Browserbase session creation returned an empty connection URL",
        );
      }

      let sessionReleased = false;
      let extensionCleaned = extension === undefined;
      const connection = BrowserbaseSessionConnectionSchema.parse({ sessionId, cdpUrl });
      return {
        ...connection,
        async close() {
          let releaseError: unknown;
          if (!sessionReleased) {
            try {
              await browserbase.releaseSession(sessionId);
              sessionReleased = true;
            } catch (error) {
              releaseError = error;
            }
          }

          let extensionCleanupError: unknown;
          if (!extensionCleaned && extension) {
            try {
              await extension.cleanup();
              extensionCleaned = true;
            } catch (error) {
              extensionCleanupError = error;
            }
          }

          if (releaseError) throw releaseError;
          if (extensionCleanupError) throw extensionCleanupError;
        },
      };
    },
    async connectSession(sessionId) {
      const normalizedSessionId = sessionId.trim();
      if (normalizedSessionId.length === 0) {
        throw new BrowserbaseSessionError("A Browserbase session ID is required");
      }

      let session: Awaited<ReturnType<BrowserbaseApiClient["retrieveSession"]>>;
      try {
        session = await browserbase.retrieveSession(normalizedSessionId);
      } catch {
        throw new BrowserbaseSessionError("Failed to retrieve the Browserbase session");
      }
      const cdpUrl = session.connectUrl?.trim();
      if (!cdpUrl) {
        throw new BrowserbaseSessionError("Browserbase session is not available for connection");
      }
      return BrowserbaseSessionConnectionSchema.parse({
        sessionId: session.id.trim() || normalizedSessionId,
        cdpUrl,
        ...(session.region === undefined ? {} : { region: session.region }),
      });
    },
  };
}

async function cleanupInvalidSession(
  browserbase: BrowserbaseApiClient,
  sessionId: string,
  extension: ProvisionedBrowserbaseExtension | undefined,
): Promise<void> {
  if (sessionId.length > 0) {
    await browserbase.releaseSession(sessionId).catch(() => undefined);
  }
  await extension?.cleanup().catch(() => undefined);
}
