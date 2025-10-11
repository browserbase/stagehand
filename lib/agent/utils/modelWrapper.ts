import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import type { LLMClient } from "../../llm/LLMClient";
import { ContextManager } from "../contextManager";

export function modelWrapper(
  llmClient: LLMClient,
  contextManager: ContextManager,
  sessionId: string,
): LanguageModel {
  const baseModel: LanguageModel = llmClient.getLanguageModel();
  return wrapLanguageModel({
    model: baseModel,
    middleware: {
      transformParams: async ({ params }) => {
        const processedPrompt = await contextManager.processMessages(
          params.prompt,
          sessionId,
          llmClient,
        );
        return { ...params, prompt: processedPrompt };
      },
    },
  });
}
