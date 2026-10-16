import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelConfig, StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import type { ClientBrowserbaseRequest } from "../clients/browserbaseClient.js";
import { apiUrlForRegion } from "../clients/stagehandApi.js";
import { boundFetch } from "./boundFetch.js";

interface LegacyGatewayContext {
  source?: "legacy";
  apiUrl: string;
  apiKey: string;
  sessionId: string;
}

interface ClientGatewayContext {
  source: "client";
  sessionId: string;
  request?: ClientBrowserbaseRequest;
}

export type GatewayContext = LegacyGatewayContext | ClientGatewayContext;

// Used only to construct AI SDK requests; the client selects the HTTP endpoint.
const CLIENT_GATEWAY_BASE_URL = "https://stagehand.invalid/llm";
const CLIENT_GATEWAY_API_KEY = "stagehand-client-gateway";

/** Selects the configured transport for Browserbase Model Gateway inference. */
export function buildGatewayContext(
  initParams: StagehandInitParams,
  request?: ClientBrowserbaseRequest,
): GatewayContext | undefined {
  const sessionId = initParams.browser?.sessionId;
  if (!sessionId) return undefined;
  if (initParams.browserbase === "client") return { source: "client", sessionId, request };
  if (!initParams.apiKey) return undefined;
  return {
    apiUrl: apiUrlForRegion(initParams.browser?.region, initParams.apiUrl),
    apiKey: initParams.apiKey,
    sessionId,
  };
}

function withoutModel(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") return await fetch(input, init);

    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return await fetch(input, init);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return await fetch(input, init);
    }

    const routedBody = { ...(body as Record<string, unknown>) };
    delete routedBody.model;
    return await fetch(input, {
      ...init,
      body: JSON.stringify(routedBody),
    });
  };
}

// Uses the load-time fetch ref (see boundFetch), not the ambient global.
export const fetchWithoutModel = withoutModel(boundFetch);

function clientGatewayFetch(
  gateway: ClientGatewayContext,
  config: ModelConfig | undefined,
): typeof globalThis.fetch {
  const hasAuthorization = Object.keys(config?.headers ?? {}).some(
    (name) => name.toLowerCase() === "authorization",
  );
  return async (input, init) => {
    if (
      input !== `${CLIENT_GATEWAY_BASE_URL}/responses` ||
      init?.method !== "POST" ||
      typeof init.body !== "string"
    ) {
      throw new TypeError("Unexpected Model Gateway request");
    }
    if (!gateway.request) throw new Error("Client Browserbase transport is unavailable");
    const headers = new Headers(init.headers);
    // Only the adapter-generated default is omitted; explicit authorization stays intact.
    if (!hasAuthorization) headers.delete("authorization");
    return await gateway.request(
      { operation: "gateway.responses", headers: Object.fromEntries(headers), body: init.body },
      init.signal ?? undefined,
    );
  };
}

/** Creates an OpenAI Responses model backed by Browserbase Model Gateway. */
export function createGatewayLanguageModel(
  config: ModelConfig | undefined,
  gateway: GatewayContext,
): LanguageModel {
  if (gateway.source === "client") {
    const fetch = clientGatewayFetch(gateway, config);
    return createOpenAI({
      apiKey: CLIENT_GATEWAY_API_KEY,
      baseURL: CLIENT_GATEWAY_BASE_URL,
      headers: config?.headers,
      fetch: config ? fetch : withoutModel(fetch),
    }).responses(config?.modelName ?? "auto");
  }

  const provider = createOpenAI({
    // Satisfies the SDK's required-key check; the server authenticates via
    // the x-bb-* headers and ignores the Authorization header.
    apiKey: gateway.apiKey,
    baseURL: `${gateway.apiUrl}/llm`,
    headers: {
      ...config?.headers,
      "x-bb-api-key": gateway.apiKey,
      "x-bb-session-id": gateway.sessionId,
    },
    // Load-time fetch ref (see boundFetch); fetchWithoutModel also strips `model`.
    fetch: config ? boundFetch : fetchWithoutModel,
  });
  return provider.responses(config?.modelName ?? "auto");
}
