import Browserbase from "@browserbasehq/sdk";
import type { BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import {
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
  type BrowserbaseExtensionSdk,
  type ProvisionedBrowserbaseExtension,
} from "./browserbaseExtension.js";

export type BrowserbaseSessionClient = {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ sessionId: string; cdpUrl: string; close?: () => Promise<void> | void }>;
};

export type BrowserbaseSessionClientFactory = (apiKey: string) => BrowserbaseSessionClient;

export type BrowserbaseApiClient = BrowserbaseExtensionClient & {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ id: string; connectUrl: string }>;
  releaseSession(sessionId: string): Promise<void>;
};

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
  provisionExtension?: (
    client: BrowserbaseExtensionClient,
  ) => Promise<ProvisionedBrowserbaseExtension>;
};

type BrowserbaseSdk = BrowserbaseExtensionSdk & {
  sessions: {
    create(params: Browserbase.SessionCreateParams): Promise<{ id: string; connectUrl: string }>;
    update(sessionId: string, params: { status: "REQUEST_RELEASE" }): Promise<unknown>;
  };
};

type BrowserbaseSdkFactory = (apiKey: string) => BrowserbaseSdk;

export function createBrowserbaseSessionClient(
  apiKey: string,
  dependencies: BrowserbaseSessionClientDependencies = {},
): BrowserbaseSessionClient {
  const browserbase = dependencies.browserbase ?? createBrowserbaseApiClient(apiKey);
  const provisionExtension = dependencies.provisionExtension ?? provisionBrowserbaseExtension;

  return {
    async createSession(params) {
      const extension = await provisionExtension(browserbase);
      let session: { id: string; connectUrl: string };

      try {
        session = await browserbase.createSession({
          ...params,
          extensionId: extension.extensionId,
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

export function createBrowserbaseApiClient(
  apiKey: string,
  createSdk: BrowserbaseSdkFactory = (key) => new Browserbase({ apiKey: key }),
): BrowserbaseApiClient {
  const sdk = createSdk(apiKey);
  const extensionClient = createBrowserbaseExtensionClient(apiKey, () => sdk);

  return {
    ...extensionClient,
    async createSession(params) {
      const session = await sdk.sessions.create(params as Browserbase.SessionCreateParams);
      return { id: session.id, connectUrl: session.connectUrl };
    },
    async releaseSession(sessionId) {
      await sdk.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
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
