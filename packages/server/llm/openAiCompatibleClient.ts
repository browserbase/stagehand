import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleModelTarget } from "./modelTarget.js";

/** Creates an OpenAI Responses-compatible model for a caller-controlled endpoint. */
export function createOpenAICompatibleLanguageModel(
  target: OpenAICompatibleModelTarget,
): LanguageModel {
  return createOpenAI({
    apiKey: target.apiKey ?? "",
    baseURL: target.baseURL,
    headers: target.headers,
  }).responses(target.modelName);
}
