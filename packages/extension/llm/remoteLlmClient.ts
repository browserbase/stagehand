import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import { LLMGenerateParamsSchema, LLMGenerateResultSchema } from "../../protocol/schemas.js";

type RemoteLLMRequest = (params: LLMGenerateParams) => Promise<LLMGenerateResult>;

/** An LLM implemented by the connected SDK and invoked through JSON-RPC. */
export class RemoteLLMClient {
  constructor(readonly request: RemoteLLMRequest) {}

  async generate(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const parsedParams = LLMGenerateParamsSchema.parse(params);
    return LLMGenerateResultSchema.parse(await this.request(parsedParams));
  }
}
