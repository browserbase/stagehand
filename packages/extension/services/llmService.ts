import type { LanguageModel } from "ai";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import { LLMGenerateParamsSchema } from "../../protocol/schemas.js";
import { generateWithAiSdk } from "../llm/aiSdkClient.js";
import { generateWithClientLlm, type ClientLlmRequest } from "../llm/clientLlmClient.js";

type AiSdkLlmSource = {
  source: "ai-sdk";
  model: LanguageModel;
};

type ClientLlmSource = {
  source: "client";
  request: ClientLlmRequest;
};

type LlmSource = AiSdkLlmSource | ClientLlmSource;

/** Generates a Stagehand LLM result using the configured local or connected client. */
export async function generate(
  source: LlmSource,
  input: LLMGenerateParams,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);

  if (source.source === "client") {
    return await generateWithClientLlm(source.request, params);
  }

  return await generateWithAiSdk(source.model, params);
}
