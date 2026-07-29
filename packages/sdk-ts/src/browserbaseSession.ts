import type { BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import {
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
  type ProvisionedBrowserbaseExtension,
} from "./browserbaseExtension.js";
import {
  createBrowserbaseApiClient,
  type BrowserbaseApiClient,
  type BrowserbaseApiClientOptions,
} from "./browserbaseClient.js";
import { STAGEHAND_SESSION_METADATA } from "./sdkIdentity.js";

export type BrowserbaseSessionClient = {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ sessionId: string; cdpUrl: string; close?: () => Promise<void> | void }>;
};

export type BrowserbaseSessionClientFactory = (apiKey: string) => BrowserbaseSessionClient;

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
  browserbaseApi?: BrowserbaseApiClientOptions;
  provisionExtension?: (
    client: BrowserbaseExtensionClient,
  ) => Promise<ProvisionedBrowserbaseExtension>;
};

export function createBrowserbaseSessionClient(
  apiKey: string,
  dependencies: BrowserbaseSessionClientDependencies = {},
): BrowserbaseSessionClient {
  const browserbase =
    dependencies.browserbase ?? createBrowserbaseApiClient(apiKey, dependencies.browserbaseApi);
  const provisionExtension = dependencies.provisionExtension ?? provisionBrowserbaseExtension;

  return {
    async createSession(params) {
      const extension = await provisionExtension(browserbase);
      let session: { id: string; connectUrl: string };

      try {
        session = await browserbase.createSession({
          ...params,
          extensionId: extension.extensionId,
          userMetadata: {
            ...params.userMetadata,
            ...STAGEHAND_SESSION_METADATA,
          },
        });
      } catch (error) {
        await extension.cleanup().catch(() => undefined);
        throw new Error("Failed to create a Browserbase session", { cause: error });
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
      let extensionCleaned = false;
      return {
        sessionId,
        cdpUrl,
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
          if (!extensionCleaned) {
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
  };
}

async function cleanupInvalidSession(
  browserbase: BrowserbaseApiClient,
  sessionId: string,
  extension: ProvisionedBrowserbaseExtension,
): Promise<void> {
  if (sessionId.length > 0) {
    await browserbase.releaseSession(sessionId).catch(() => undefined);
  }
  await extension.cleanup().catch(() => undefined);
}
