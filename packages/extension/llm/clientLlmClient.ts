import {
  createLLMGenerateResultSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";

export type ClientLlmRequest = (params: LLMGenerateParams) => Promise<LLMGenerateResult>;

/** Sends a Stagehand LLM request to the connected SDK and awaits its response. */
export async function generateWithClientLlm(
  request: ClientLlmRequest,
  input: LLMGenerateParams,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);
  const candidate: unknown = await request(params);
  const validatedResult: unknown = createLLMGenerateResultSchema(params).parse(candidate);
  return LLMGenerateResultSchema.parse(validatedResult);
}
