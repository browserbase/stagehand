import Browserbase from "@browserbasehq/sdk";
import type { BrowserbaseExtension, BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import { STAGEHAND_SESSION_METADATA } from "./sdkIdentity.js";

const STAGEHAND_BROWSER_EXTENSION = "stagehand";

export type BrowserbaseSessionClient = {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ sessionId: string; cdpUrl: string; close?: () => Promise<void> | void }>;
};

export type BrowserbaseSessionClientFactory = (apiKey: string) => BrowserbaseSessionClient;

export type BrowserbaseApiClient = {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ id: string; connectUrl: string }>;
  releaseSession(sessionId: string): Promise<void>;
};

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
};

type BrowserbaseSdk = {
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

  return {
    async createSession(params) {
      let session: { id: string; connectUrl: string };

      try {
        session = await browserbase.createSession({
          ...withStagehandExtension(params),
          userMetadata: {
            ...params.userMetadata,
            ...STAGEHAND_SESSION_METADATA,
          },
        });
      } catch (error) {
        throw new Error("Failed to create a Browserbase session", { cause: error });
      }

      const sessionId = session.id.trim();
      const cdpUrl = session.connectUrl.trim();
      if (sessionId.length === 0 || cdpUrl.length === 0) {
        await cleanupInvalidSession(browserbase, sessionId);
        throw new Error(
          sessionId.length === 0
            ? "Browserbase session creation returned an empty session ID"
            : "Browserbase session creation returned an empty connection URL",
        );
      }

      let sessionReleased = false;
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

          if (releaseError) throw releaseError;
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

  return {
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
): Promise<void> {
  if (sessionId.length > 0) {
    await browserbase.releaseSession(sessionId).catch(() => undefined);
  }
}

function withStagehandExtension(
  params: BrowserbaseSessionCreateParams,
): BrowserbaseSessionCreateParams {
  const extensions = [
    ...new Set<BrowserbaseExtension>([
      ...(params.browserSettings?.extensions ?? []),
      STAGEHAND_BROWSER_EXTENSION,
    ]),
  ];
  return {
    ...params,
    browserSettings: {
      ...params.browserSettings,
      extensions,
    },
  };
}
