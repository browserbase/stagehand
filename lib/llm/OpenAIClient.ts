import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  LLMClient,
  ChatCompletionOptions,
  ExtractionOptions,
} from "./LLMClient";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    const response = await this.client.chat.completions.create({
      ...options,
      messages: options.messages,
    });

    // The response is already in the correct format for OpenAI
    return response;
  }

  async createExtraction(options: ExtractionOptions) {
    console.log("createExtraction", options);
    const responseFormat = zodResponseFormat(options.response_model.schema, options.response_model.name);
    console.log("responseFormat", responseFormat);
    const completion = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      response_format: responseFormat,
    });

    const extractedData = completion.choices[0].message.content;
    
    // Parse the extracted data to match the expected format
    const parsedData = JSON.parse(extractedData);
    
    const response = {
      ...parsedData,
    };

    return response;
  }
}