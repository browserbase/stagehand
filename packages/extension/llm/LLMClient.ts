import {
  embed,
  embedMany,
  generateImage,
  generateSpeech,
  generateText,
  streamText,
  transcribe,
} from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod/v4";
import type { LogLine, ModelName } from "../../protocol/types.js";
import type { ChatCompletionOptionsSchema } from "./schemas.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

export type ChatMessageContent = string | (ChatMessageImageContent | ChatMessageTextContent)[];

export type ChatMessageImageContent = ChatMessageImageUrlContent | ChatMessageSourceImageContent;

export interface ChatMessageImageUrlContent {
  type: "image_url";
  image_url: { url: string };
  text?: string;
}

export interface ChatMessageSourceImageContent {
  type: "image";
  text?: string;
  source: {
    type: string;
    media_type: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
    data: string;
  };
}

export interface ChatMessageTextContent {
  type: "text";
  text: string;
}

export const AnnotatedScreenshotText =
  "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";

export type ChatCompletionOptionsInput = z.input<typeof ChatCompletionOptionsSchema>;

export type ChatCompletionOptions = z.output<typeof ChatCompletionOptionsSchema>;

export type LLMResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export interface CreateChatCompletionOptions {
  options: ChatCompletionOptionsInput;
  logger: (message: LogLine) => void;
}

/** Simple usage shape if your LLM returns usage tokens. */
export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
}

/**
 * For calls that use a schema: the LLMClient may return { data: T; usage?: LLMUsage }
 */
export interface LLMParsedResponse<T> {
  data: T;
  usage?: LLMUsage;
}

export abstract class LLMClient {
  public abstract type: "openai" | "anthropic" | "cerebras" | "groq" | (string & {});
  public modelName: ModelName;
  public hasVision = false;
  // Compile-only bridge: provider SDK option types diverge from V3's shared options.
  public clientOptions: unknown;
  public userProvidedInstructions?: string;

  constructor(modelName: ModelName, userProvidedInstructions?: string) {
    this.modelName = modelName;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  // Overload 1: When response_model is provided, returns LLMParsedResponse<T>
  abstract createChatCompletion<T>(
    options: CreateChatCompletionOptions & {
      options: {
        response_model: { name: string; schema: z.ZodType };
      };
    },
  ): Promise<LLMParsedResponse<T>>;

  // Overload 2: When response_model is not provided, returns T (defaults to LLMResponse)
  abstract createChatCompletion<T = LLMResponse>(options: CreateChatCompletionOptions): Promise<T>;

  public generateText = generateText;
  public streamText = streamText;
  public generateImage = generateImage;
  public embed = embed;
  public embedMany = embedMany;
  public transcribe = transcribe;
  public generateSpeech = generateSpeech;

  getLanguageModel?(): LanguageModel;
}
