import type { V4BrowserRecord, V4LLMRecord } from "../../types.js";
import { getStagehandForBrowser } from "../base.js";
import { BaseLLMService, type LLMRequestPayload } from "./BaseLLMService.js";

export class AisdkLLMService extends BaseLLMService {
  protected readonly clientType: V4LLMRecord["clientType"] = "aisdk";

  protected async requestModel(
    payload: LLMRequestPayload,
    llm: V4LLMRecord,
    browser: V4BrowserRecord,
  ): Promise<unknown> {
    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey ?? llm.modelApiKey,
    );

    const completionOptions = {
      ...(payload.options ?? {}),
      messages: payload.messages as any,
    };

    return stagehand.llmClient.createChatCompletion({
      options: completionOptions as any,
      logger: () => {},
    });
  }
}
