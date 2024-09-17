import OpenAI from "openai";
import Instructor, { type InstructorClient } from "@instructor-ai/instructor";

export class LLMProvider {
  private openAIModels = ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini'];

  getExtractionClient(model_name: string): InstructorClient<OpenAI> {
    const openai = this.getOpenAIInstance(model_name);
    return Instructor({
      client: openai,
      mode: "TOOLS",
    });
  }

  getChatClient(model_name: string): OpenAI {
    return this.getOpenAIInstance(model_name);
  }

  private getOpenAIInstance(model_name: string): OpenAI {
    if (!this.openAIModels.includes(model_name)) {
      throw new ValueError(`Unsupported model: ${model_name}`);
    }
    return new OpenAI();
  }
}

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}