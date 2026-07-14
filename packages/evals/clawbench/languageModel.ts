import type { LanguageModelV2 } from "@ai-sdk/provider";
import { getAISDKLanguageModel } from "@browserbasehq/stagehand";
import { providerForApiType } from "./apiTypes.js";
import type { ClawBenchModelConfig } from "./types.js";

export function getClawBenchLanguageModel(
  config: ClawBenchModelConfig,
): LanguageModelV2 {
  const provider = providerForApiType(config.api_type);

  return getAISDKLanguageModel(provider, config.model, {
    apiKey: config.api_key,
    baseURL: config.base_url,
  });
}
