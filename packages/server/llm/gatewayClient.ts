import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelConfig, StagehandInitParams } from "../../protocol/types.js";
import { apiUrlForRegion } from "../clients/stagehandApi.js";

export interface GatewayContext {
  apiUrl: string;
  apiKey: string;
  sessionId: string;
}

/** Builds the credentials needed for Browserbase Model Gateway inference. */
export function buildGatewayContext(initParams: StagehandInitParams): GatewayContext | undefined {
  const sessionId = initParams.browser?.sessionId;
  if (!initParams.apiKey || !sessionId) return undefined;
  return {
    apiUrl: apiUrlForRegion(initParams.browser?.region),
    apiKey: initParams.apiKey,
    sessionId,
  };
}

/** Creates an OpenAI Responses model backed by Browserbase Model Gateway. */
export function createGatewayLanguageModel(
  config: ModelConfig | undefined,
  gateway: GatewayContext,
): LanguageModel {
  const fetchWithoutModel: typeof globalThis.fetch = async (input, init) => {
    if (typeof init?.body !== "string") return await globalThis.fetch(input, init);

    const body: unknown = JSON.parse(init.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return await globalThis.fetch(input, init);
    }

    const routedBody = { ...(body as Record<string, unknown>) };
    delete routedBody.model;
    return await globalThis.fetch(input, {
      ...init,
      body: JSON.stringify(routedBody),
    });
  };

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
    ...(config ? {} : { fetch: fetchWithoutModel }),
  });
  return provider.responses(config?.modelName ?? "auto");
}
