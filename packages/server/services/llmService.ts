import type {
  ClientModelReference,
  LLMGenerateParams,
  LLMGenerateResult,
  ModelConfig,
} from "../../protocol/types.js";
import { LLMGenerateParamsSchema } from "../../protocol/schemas.js";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import { generateWithClientLlm, type ClientLlmRequest } from "../llm/clientLlmClient.js";
import { createGatewayLanguageModel, type GatewayContext } from "../llm/gatewayClient.js";
import { resolveModelTarget } from "../llm/modelTarget.js";
import { createOpenAICompatibleLanguageModel } from "../llm/openAiCompatibleClient.js";

/** Generates a Stagehand LLM result using the configured local or connected client. */
export async function generate(
  model: ModelConfig | ClientModelReference,
  input: LLMGenerateParams,
  clientRequest: ClientLlmRequest,
  gateway?: GatewayContext,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);

  if ("source" in model) {
    return await generateWithClientLlm(clientRequest, params);
  }

  const target = resolveModelTarget(model);

  switch (target.type) {
    case "direct":
      return await generateWithAiSdk(createAiSdkLanguageModel(target), params);
    case "openai-compatible":
      return await generateWithAiSdk(createOpenAICompatibleLanguageModel(target), params);
    case "browserbase":
      if (!gateway) {
        throw new Error("Browserbase gateway inference requires a Browserbase API key and session");
      }
      return await generateWithAiSdk(createGatewayLanguageModel(target, gateway), params);
  }
}
