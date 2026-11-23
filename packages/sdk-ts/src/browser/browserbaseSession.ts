import Browserbase from "@browserbasehq/sdk";
import {
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
  type BrowserbaseExtensionSdk,
  type ProvisionedBrowserbaseExtension,
} from "../browserbaseExtension.js";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import { getExtensionFingerprint } from "../extensionAssets.js";
import { STAGEHAND_SDK_CLIENT_INFO, STAGEHAND_SESSION_METADATA } from "../sdkIdentity.js";
import {
  BrowserbaseSessionConnectionSchema,
  type BrowserbaseClientOptions,
  BrowserbaseSessionCreateResultSchema,
  BrowserbaseSessionRetrieveResultSchema,
  type BrowserbaseSessionConnection,
  type BrowserbaseSessionCreateOptions,
  type BrowserbaseSessionCreateResult,
  type BrowserbaseSessionRetrieveResult,
} from "../clientSchemas.js";

type OwnedBrowserbaseSession = BrowserbaseSessionConnection & {
  close: () => Promise<void> | void;
};

export type BrowserbaseSessionClient = {
  createSession(params: BrowserbaseSessionCreateOptions): Promise<OwnedBrowserbaseSession>;
  connectSession?(sessionId: string): Promise<OwnedBrowserbaseSession>;
};

export type BrowserbaseSessionClientFactory = (
  apiKey: string,
  baseUrl: string,
  clientOptions?: BrowserbaseClientOptions,
) => BrowserbaseSessionClient;

// @browserbasehq/sdk does not type `stagehand` yet; use Browserbase.SessionCreateParams once it does.
type BrowserbaseSessionCreateBody = Omit<Browserbase.SessionCreateParams, "stagehand"> & {
  stagehand?: BuiltInExtensionParams;
};

type BuiltInExtensionParams = {
  protocolVersion?: string;
  clientInfo?: { name: string; version: string };
  extensionFingerprint?: string;
};

export type BrowserbaseApiClient = BrowserbaseExtensionClient & {
  createSession(params: BrowserbaseSessionCreateBody): Promise<BrowserbaseSessionCreateResult>;
  retrieveSession(sessionId: string): Promise<BrowserbaseSessionRetrieveResult>;
  releaseSession(sessionId: string): Promise<void>;
};

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
  provisionExtension?: (
    client: BrowserbaseExtensionClient,
  ) => Promise<ProvisionedBrowserbaseExtension>;
  readExtensionFingerprint?: () => Promise<string>;
};

type BrowserbaseSdk = BrowserbaseExtensionSdk & {
  sessions: {
    create(params: Browserbase.SessionCreateParams): Promise<unknown>;
    retrieve(sessionId: string): Promise<unknown>;
    update(sessionId: string, params: { status: "REQUEST_RELEASE" }): Promise<unknown>;
  };
};

type BrowserbaseSdkFactory = (
  apiKey: string,
  baseUrl: string,
  clientOptions: BrowserbaseClientOptions,
) => BrowserbaseSdk;

const BUILT_IN_EXTENSION_HINT =
  "If Browserbase's built-in Stagehand extension is not available for this project or region " +
  "yet, remove `stagehand: true` to upload the bundled one.";

export class BrowserbaseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserbaseSessionError";
  }
}

export function createBrowserbaseSessionClient(
  apiKey: string,
  baseUrl: string,
  clientOptions: BrowserbaseClientOptions = {},
  dependencies: BrowserbaseSessionClientDependencies = {},
): BrowserbaseSessionClient {
  const browserbase =
    dependencies.browserbase ?? createBrowserbaseApiClient(apiKey, baseUrl, clientOptions);
  const provisionExtension = dependencies.provisionExtension ?? provisionBrowserbaseExtension;
  const readExtensionFingerprint = dependencies.readExtensionFingerprint ?? getExtensionFingerprint;

  return {
    async createSession({ stagehand, ...params }) {
      const builtInExtension =
        stagehand === true ? await builtInExtensionParams(readExtensionFingerprint) : undefined;
      const callerExtensionId = params.extensionId ?? params.browserSettings?.extensionId;
      const extension =
        callerExtensionId === undefined && builtInExtension === undefined
          ? await provisionExtension(browserbase)
          : undefined;
      let session: BrowserbaseSessionCreateResult;

      try {
        session = await browserbase.createSession({
          ...params,
          ...(extension === undefined ? {} : { extensionId: extension.extensionId }),
          ...(builtInExtension === undefined
            ? { userMetadata: { ...params.userMetadata, ...STAGEHAND_SESSION_METADATA } }
            : { stagehand: builtInExtension }),
        });
      } catch (error) {
        await extension?.cleanup().catch(() => undefined);
        throw new BrowserbaseSessionError(
          builtInExtension !== undefined &&
            error instanceof Browserbase.APIError &&
            error.status === 400
            ? "Failed to create a Browserbase session. " + BUILT_IN_EXTENSION_HINT
            : "Failed to create a Browserbase session",
        );
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
      let sessionReleased = false;
      const connection = BrowserbaseSessionConnectionSchema.parse({
        sessionId: session.id.trim() || normalizedSessionId,
        cdpUrl,
        ...(session.region === undefined ? {} : { region: session.region }),
      });
      return {
        ...connection,
        async close() {
          if (sessionReleased) return;
          await browserbase.releaseSession(connection.sessionId);
          sessionReleased = true;
        },
      };
    },
  };
}

export function createBrowserbaseApiClient(
  apiKey: string,
  baseUrl: string,
  clientOptions: BrowserbaseClientOptions = {},
  createSdk: BrowserbaseSdkFactory = (key, baseURL, options) =>
    new Browserbase({ ...options, apiKey: key, baseURL }),
): BrowserbaseApiClient {
  const sdk = createSdk(apiKey, baseUrl, clientOptions);
  const extensionClient = createBrowserbaseExtensionClient(apiKey, () => sdk);

  return {
    ...extensionClient,
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

async function builtInExtensionParams(
  readExtensionFingerprint: () => Promise<string>,
): Promise<BuiltInExtensionParams> {
  const extensionFingerprint = await readExtensionFingerprint().catch(() => undefined);
  return {
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    clientInfo: { ...STAGEHAND_SDK_CLIENT_INFO },
    ...(extensionFingerprint === undefined ? {} : { extensionFingerprint }),
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
