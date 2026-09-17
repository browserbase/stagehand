import type {
  ClientModelReference,
  LLMGenerateParams,
  LLMGenerateResult,
  ModelConfig,
} from "@browserbasehq/stagehand-protocol/types";
import { LLMGenerateParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import { generateWithClientLlm, type ClientLlmRequest } from "../llm/clientLlmClient.js";
import { createGatewayLanguageModel, type GatewayContext } from "../llm/gatewayClient.js";

/** Generates a Stagehand LLM result using the configured local or connected client. */
export async function generate(
  model: ModelConfig | ClientModelReference | undefined,
  input: LLMGenerateParams,
  clientRequest: ClientLlmRequest,
  gateway?: GatewayContext,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);

  if (model && "source" in model) {
    return await generateWithClientLlm(clientRequest, params);
  }

  if (!model?.apiKey) {
    if (!gateway) {
      throw new Error("Model inference requires a provider API key or a Browserbase session");
    }
    if (params.stopSequences && params.stopSequences.length > 0) {
      throw new Error("Browserbase Model Gateway does not support stop sequences");
    }
    return await generateWithAiSdk(createGatewayLanguageModel(model, gateway), params);
  }

  return await generateWithAiSdk(createAiSdkLanguageModel(model, params), params);
}
