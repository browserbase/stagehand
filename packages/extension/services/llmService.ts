import type {
  ClientModelReference,
  LLMGenerateParams,
  LLMGenerateResult,
  ModelConfig,
} from "../../protocol/types.js";
import { LLMGenerateParamsSchema } from "../../protocol/schemas.js";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import { generateWithClientLlm, type ClientLlmRequest } from "../llm/clientLlmClient.js";

/** Generates a Stagehand LLM result using the configured local or connected client. */
export async function generate(
  model: ModelConfig | ClientModelReference,
  input: LLMGenerateParams,
  clientRequest: ClientLlmRequest,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);

  if ("source" in model) {
    return await generateWithClientLlm(clientRequest, params);
  }

  if ("baseURL" in model) {
    throw new Error("Custom OpenAI-compatible inference is not implemented yet");
  }

  if (!model.apiKey) {
    // TODO: Send configurations without direct credentials through Browserbase Model Gateway.
    throw new Error("Direct model inference requires an API key");
  }

  return await generateWithAiSdk(createAiSdkLanguageModel(model), params);
}
