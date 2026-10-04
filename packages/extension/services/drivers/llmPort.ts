import type {
  ClientModelReference,
  ModelConfig,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import type { ClientLlmRequest } from "../../llm/clientLlmClient.js";
import type { GatewayContext } from "../../llm/gatewayClient.js";
import * as llmService from "../llmService.js";
import { zeroStagehandResultUsage } from "../resultUsage.js";
import type { LlmPort } from "./types.js";

export type LlmAccess = {
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  gateway?: GatewayContext;
  systemPrompt?: string;
};

/**
 * The model one operation was configured with, plus a meter of what the operation spent on it.
 * Every driver in a chain records into the same meter, so the reported usage is the whole
 * operation's, whoever made the calls.
 */
export function createLlmPort(access: LlmAccess): { llm: LlmPort; usage(): StagehandResultUsage } {
  let spent = zeroStagehandResultUsage();
  return {
    llm: {
      generate: (params) =>
        llmService.generate(access.model, params, access.clientLLMGenerate, access.gateway),
      record(usage) {
        spent = {
          inputTokens: spent.inputTokens + usage.prompt_tokens,
          outputTokens: spent.outputTokens + usage.completion_tokens,
          reasoningTokens: spent.reasoningTokens + usage.reasoning_tokens,
          cachedInputTokens: spent.cachedInputTokens + usage.cached_input_tokens,
          inferenceTimeMs: spent.inferenceTimeMs + usage.inference_time_ms,
        };
      },
      systemPrompt: access.systemPrompt ?? "",
    },
    usage: () => ({ ...spent }),
  };
}
