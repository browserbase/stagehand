import { up } from "up-fetch";
import { z } from "zod/v4";
import type { BrowserbaseRegion, BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import { BrowserbaseRegionSchema } from "../../protocol/schemas.js";
import {
  stagehandExtensionFileName,
  type BrowserbaseExtensionClient,
} from "./browserbaseExtension.js";

const DEFAULT_BROWSERBASE_API_URL = "https://api.browserbase.com";
const DEFAULT_BROWSERBASE_API_TIMEOUT_MS = 60_000;

const BrowserbaseExtensionResponseSchema = z.looseObject({
  id: z.string(),
});

const BrowserbaseSessionResponseSchema = z.looseObject({
  id: z.string(),
  connectUrl: z.url({ protocol: /^wss?$/ }),
});

const BrowserbaseSessionRetrieveResponseSchema = z.looseObject({
  id: z.string(),
  connectUrl: z.url({ protocol: /^wss?$/ }).optional(),
  region: BrowserbaseRegionSchema.optional(),
});

export type BrowserbaseApiClient = BrowserbaseExtensionClient & {
  createSession(
    params: BrowserbaseSessionCreateParams,
  ): Promise<{ id: string; connectUrl: string }>;
  retrieveSession(
    sessionId: string,
  ): Promise<{ id: string; connectUrl?: string; region?: BrowserbaseRegion }>;
  releaseSession(sessionId: string): Promise<void>;
};

export type BrowserbaseApiClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeout?: number;
};

export function createBrowserbaseApiClient(
  apiKey: string,
  options: BrowserbaseApiClientOptions = {},
): BrowserbaseApiClient {
  if (apiKey.trim().length === 0) {
    throw new Error("A Browserbase API key is required");
  }

  const fetchBrowserbase = up(options.fetch ?? globalThis.fetch, () => ({
    baseUrl: options.baseUrl ?? DEFAULT_BROWSERBASE_API_URL,
    headers: { "X-BB-API-Key": apiKey },
    timeout: options.timeout ?? DEFAULT_BROWSERBASE_API_TIMEOUT_MS,
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
    async retrieveSession(sessionId) {
      const session = await fetchBrowserbase(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
        schema: BrowserbaseSessionRetrieveResponseSchema,
      });
      return {
        id: session.id,
        ...(session.connectUrl === undefined ? {} : { connectUrl: session.connectUrl }),
        ...(session.region === undefined ? {} : { region: session.region }),
      };
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
