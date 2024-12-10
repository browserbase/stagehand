import { ZodType } from "zod";
import {
  AnthropicTransformedResponse,
  AvailableModel,
  ClientOptions,
  ToolCall,
} from "../../types/model";
import {
  ChatCompletion,
  ChatCompletionToolChoiceOption,
} from "openai/resources";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

export type ChatMessageContent =
  | string
  | (ChatMessageImageContent | ChatMessageTextContent)[];

export interface ChatMessageImageContent {
  type: "image_url";
  image_url: { url: string };
  text?: string;
}

export interface ChatMessageTextContent {
  type: string;
  text: string;
}

export const modelsWithVision: AvailableModel[] = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "gpt-4o-2024-08-06",
];

export const AnnotatedScreenshotText =
  "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  image?: {
    buffer: Buffer;
    description?: string;
  };
  response_model?: {
    name: string;
    schema: ZodType;
  };
  tools?: ToolCall[];
  tool_choice?: "auto" | ChatCompletionToolChoiceOption;
  maxTokens?: number;
  requestId: string;
}

export type LLMResponse = AnthropicTransformedResponse | ChatCompletion;

export abstract class LLMClient {
  public type: "openai" | "anthropic";
  public modelName: AvailableModel;
  public hasVision: boolean;
  public clientOptions: ClientOptions;

  constructor(modelName: AvailableModel) {
    this.modelName = modelName;
    this.hasVision = modelsWithVision.includes(modelName);
  }

  abstract createChatCompletion<T = LLMResponse>(
    options: ChatCompletionOptions,
  ): Promise<T>;
  abstract logger: (message: { category?: string; message: string }) => void;
}
