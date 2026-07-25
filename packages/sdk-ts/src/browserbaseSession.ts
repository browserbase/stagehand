import { up } from "up-fetch";
import { z } from "zod/v4";
import type { BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import {
  provisionBrowserbaseExtension,
  stagehandExtensionFileName,
  type BrowserbaseExtensionArchiveLoader,
  type BrowserbaseExtensionClient,
  type ProvisionedBrowserbaseExtension,
} from "./browserbaseExtension.js";

const DEFAULT_BROWSERBASE_API_URL = "https://api.browserbase.com";
const BrowserbaseExtensionResponseSchema = z.looseObject({ id: z.string() });
const BrowserbaseSessionResponseSchema = z.looseObject({
  id: z.string(),
  connectUrl: z.string(),
});

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

export type BrowserbaseApiClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeout?: number;
};

type BrowserbaseSessionClientDependencies = {
  browserbase?: BrowserbaseApiClient;
  browserbaseApi?: BrowserbaseApiClientOptions;
  loadExtensionArchive?: BrowserbaseExtensionArchiveLoader;
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
  const provisionExtension =
    dependencies.provisionExtension ??
    ((client: BrowserbaseExtensionClient) =>
      provisionBrowserbaseExtension(client, dependencies.loadExtensionArchive));

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
  options: BrowserbaseApiClientOptions = {},
): BrowserbaseApiClient {
  const fetchBrowserbase = up(options.fetch ?? globalThis.fetch, () => ({
    baseUrl: options.baseUrl ?? DEFAULT_BROWSERBASE_API_URL,
    headers: { "X-BB-API-Key": apiKey },
    timeout: options.timeout ?? 60_000,
  }));

  return {
    async uploadExtension(archive) {
      const formData = new FormData();
      formData.append("file", archive, stagehandExtensionFileName());
      const extension = await fetchBrowserbase("/v1/extensions", {
        method: "POST",
        body: formData,
        schema: BrowserbaseExtensionResponseSchema,
      });
      return { id: extension.id };
    },
    async deleteExtension(extensionId) {
      await fetchBrowserbase(`/v1/extensions/${encodeURIComponent(extensionId)}`, {
        method: "DELETE",
        schema: z.null(),
      });
    },
    async createSession(params) {
      const session = await fetchBrowserbase("/v1/sessions", {
        method: "POST",
        body: params,
        schema: BrowserbaseSessionResponseSchema,
      });
      return { id: session.id, connectUrl: session.connectUrl };
    },
    async releaseSession(sessionId) {
      await fetchBrowserbase(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: "POST",
        body: { status: "REQUEST_RELEASE" },
        schema: z.unknown(),
      });
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
