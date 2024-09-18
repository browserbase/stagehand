import OpenAI from "openai";
import Instructor, { type InstructorClient } from "@instructor-ai/instructor";
import {
  LLMClient,
  ChatCompletionOptions,
  ExtractionOptions,
} from "./LLMClient";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private instructorClient: InstructorClient<OpenAI>;

  constructor() {
    this.client = new OpenAI();
    this.instructorClient = Instructor({
      client: this.client,
      mode: "TOOLS",
    });
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    return await this.client.chat.completions.create({
      ...options,
      messages: options.messages,
      // Map additional options as needed
    });
  }

  async createExtraction(options: ExtractionOptions) {
    // Use Instructor for extraction
    const response = await this.instructorClient.chat.completions.create({
      ...options,
      messages: options.messages,
      response_model: options.response_model,
    });

    return response;
  }
}