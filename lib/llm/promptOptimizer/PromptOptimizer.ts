import { LLMProvider } from "../LLMProvider";
import { ChatCompletionOptions, ChatMessage } from "../LLMClient";
import { buildPromptOptimizerPrompt } from "../../prompt";

export class PromptOptimizer {
  private llmProvider: LLMProvider;
  private model: string;

  constructor(llmProvider: LLMProvider, model: string = "gpt-4o-2024-08-06") {
    this.llmProvider = llmProvider;
    this.model = model;
  }

  async optimizePrompt(
    initialPrompt: string,
    type: "act" | "extract",
  ): Promise<string> {
    const client = this.llmProvider.getClient(this.model);

    const messages = buildPromptOptimizerPrompt(initialPrompt, type);

    const options: ChatCompletionOptions = {
      model: this.model,
      messages: messages,
      temperature: 0.7,
    };

    try {
      const response = await client.createChatCompletion(options);
      const improvedPrompt = response.choices[0].message.content.trim();

      client.logger({
        category: "PromptOptimizer",
        message: `Original prompt: "${initialPrompt}"\nImproved prompt: "${improvedPrompt}"`,
      });

      return improvedPrompt;
    } catch (error) {
      client.logger({
        category: "PromptOptimizer",
        message: `Error optimizing prompt: ${error}`,
      });
      throw error;
    }
  }
}
