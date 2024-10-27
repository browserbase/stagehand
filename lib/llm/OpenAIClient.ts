import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { LLMClient, ChatCompletionOptions } from "./LLMClient";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  public logger: (message: {
    category?: string;
    message: string;
    level?: number;
  }) => void;

  constructor(
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
    }) => void,
  ) {
    this.client = new OpenAI();
    this.logger = logger;
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    if (options.image) {
      const screenshotMessage: any = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${options.image.buffer.toString("base64")}`,
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages = [...options.messages, screenshotMessage];
    }

    const { image, response_model, ...openAiOptions } = options;

    let responseFormat = undefined;
    if (options.response_model) {
      responseFormat = zodResponseFormat(
        options.response_model.schema,
        options.response_model.name,
      );
    }

    const response = await this.client.chat.completions.create({
      ...openAiOptions,
      response_format: responseFormat,
    });

    if (response_model) {
      const extractedData = response.choices[0].message.content;
      const parsedData = JSON.parse(extractedData);

      return {
        ...parsedData,
      };
    }

    return response;
  }
}
