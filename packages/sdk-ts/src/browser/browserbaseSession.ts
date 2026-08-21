import Browserbase from "@browserbasehq/sdk";
import { STAGEHAND_SESSION_METADATA } from "../sdkIdentity.js";
import {
  BrowserbaseSessionConnectionSchema,
  BrowserbaseSessionCreateResultSchema,
  BrowserbaseSessionRetrieveResultSchema,
  type BrowserbaseSessionConnection,
  type BrowserbaseSessionCreateResult,
  type BrowserbaseSessionCreateParams,
  type BrowserbaseSessionRetrieveResult,
} from "../clientSchemas.js";

type OwnedBrowserbaseSession = BrowserbaseSessionConnection & {
  close?: () => Promise<void> | void;
};

export type BrowserbaseSessionClient = {
  createSession(params: BrowserbaseSessionCreateParams): Promise<OwnedBrowserbaseSession>;
  connectSession?(sessionId: string): Promise<BrowserbaseSessionConnection>;
};

export type BrowserbaseSessionClientFactory = (
  apiKey: string,
  baseUrl: string,
) => BrowserbaseSessionClient;

export type BrowserbaseApiClient = {
  createSession(params: BrowserbaseSessionCreateParams): Promise<BrowserbaseSessionCreateResult>;
  retrieveSession(sessionId: string): Promise<BrowserbaseSessionRetrieveResult>;
  releaseSession(sessionId: string): Promise<void>;
};

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
};

type BrowserbaseSdk = {
  sessions: {
    create(params: Browserbase.SessionCreateParams): Promise<unknown>;
    retrieve(sessionId: string): Promise<unknown>;
    update(sessionId: string, params: { status: "REQUEST_RELEASE" }): Promise<unknown>;
  };
};

type BrowserbaseSdkFactory = (apiKey: string, baseUrl: string) => BrowserbaseSdk;

export class BrowserbaseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserbaseSessionError";
  }
}

export function createBrowserbaseSessionClient(
  apiKey: string,
  baseUrl: string,
  dependencies: BrowserbaseSessionClientDependencies = {},
): BrowserbaseSessionClient {
  const browserbase = dependencies.browserbase ?? createBrowserbaseApiClient(apiKey, baseUrl);

  return {
    async createSession(params) {
      let session: BrowserbaseSessionCreateResult;

      try {
        session = await browserbase.createSession({
          ...withStagehandExtension(params),
          userMetadata: {
            ...params.userMetadata,
            ...STAGEHAND_SESSION_METADATA,
          },
        });
      } catch {
        throw new BrowserbaseSessionError("Failed to create a Browserbase session");
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

          if (releaseError) throw releaseError;
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

export function createBrowserbaseApiClient(
  apiKey: string,
  baseUrl: string,
  createSdk: BrowserbaseSdkFactory = (key, baseURL) => new Browserbase({ apiKey: key, baseURL }),
): BrowserbaseApiClient {
  const sdk = createSdk(apiKey, baseUrl);

  return {
    async createSession(params) {
      const session = await sdk.sessions.create(params as Browserbase.SessionCreateParams);
      return BrowserbaseSessionCreateResultSchema.parse(session);
    },
    async retrieveSession(sessionId) {
      const session = await sdk.sessions.retrieve(sessionId);
      return BrowserbaseSessionRetrieveResultSchema.parse(session);
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
  const extensions = [...new Set(params.browserSettings?.extensions ?? [])];
  if (!extensions.includes("stagehand")) extensions.push("stagehand");
  return {
    ...params,
    browserSettings: {
      ...params.browserSettings,
      extensions,
    },
  };
}
