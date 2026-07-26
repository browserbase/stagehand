import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { StagehandInitParams } from "../../protocol/types.js";
import { apiUrlForRegion } from "../clients/stagehandApi.js";
import type { BrowserbaseModelTarget } from "./modelTarget.js";

export type GatewayContext = {
  apiUrl: string;
  apiKey: string;
  sessionId: string;
};

/** Builds the Browserbase gateway context for a Browserbase-backed session. */
export function buildGatewayContext(initParams: StagehandInitParams): GatewayContext | undefined {
  const sessionId = initParams.browser?.sessionId;
  if (!initParams.apiKey || !sessionId) return undefined;
  return {
    apiUrl: apiUrlForRegion(initParams.browser?.region),
    apiKey: initParams.apiKey,
    sessionId,
  };
}

/** Creates an AI SDK Responses model backed by Browserbase Model Gateway. */
export function createGatewayLanguageModel(
  target: BrowserbaseModelTarget,
  gateway: GatewayContext,
): LanguageModel {
  return createOpenAI({
    apiKey: gateway.apiKey,
    baseURL: `${gateway.apiUrl}/llm`,
    headers: {
      "x-bb-api-key": gateway.apiKey,
      "x-bb-session-id": gateway.sessionId,
    },
  }).responses(target.modelName);
}
