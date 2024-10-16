import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  LLMClient,
  ChatCompletionOptions,
  ExtractionOptions,
} from "./LLMClient";

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  public logger: (message: { category?: string; message: string }) => void;


  constructor(logger: (message: { category?: string; message: string }) => void) {
    this.client = new OpenAI();
    this.logger = logger;
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    this.logger({
      category: "OpenAI",
      message:
        "Creating chat completion with options: " + JSON.stringify(options),
      level: 2,
    });

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

    console.log("[DEBUG][Options][Image]", !!options.image);

    const { image, ...optionsWithoutImage } = options;

    const response =
      await this.client.chat.completions.create(optionsWithoutImage);

    this.logger({
      category: "OpenAI",
      message: "Response from OpenAI: " + JSON.stringify(response), 
      level: 2,
    });
    return response;
  }

  async createExtraction(options: ExtractionOptions) {
    this.logger({ category: "OpenAI", 
      message: "Creating extraction with options: " + JSON.stringify(options), 
      level: 2 
    });
    const responseFormat = zodResponseFormat(options.response_model.schema, options.response_model.name);
    
    const completion = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      response_format: responseFormat,
    });

    const extractedData = completion.choices[0].message.content;
    this.logger({ category: "OpenAI", 
      message: "Extracted data: " + JSON.stringify(extractedData), 
      level: 2 
    });
    
    const parsedData = JSON.parse(extractedData);
    
    const response = {
      ...parsedData,
    };

    return response;
  }
}