import { LLMTool } from "../types/public/model.js";
import {
  embed,
  embedMany,
  experimental_generateImage,
  experimental_generateSpeech,
  experimental_transcribe,
  generateObject,
  generateText,
  streamObject,
  streamText,
} from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { LogLine } from "../types/public/logs.js";
import { AvailableModel, ClientOptions } from "../types/public/model.js";
import type { StagehandZodSchema } from "../zodCompat.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

export type ChatMessageContent =
  | string
  | (ChatMessageImageContent | ChatMessageTextContent)[];

export interface ChatMessageImageContent {
  type: string;
  image_url?: { url: string };
  text?: string;
  source?: {
    type: string;
    media_type: string;
    data: string;
  };
}

export interface ChatMessageTextContent {
  type: string;
  text: string;
}

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
    schema: StagehandZodSchema;
  };
  tools?: LLMTool[];
  tool_choice?: "auto" | "none" | "required";
  maxOutputTokens?: number;
  requestId?: string;
}

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
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export interface CreateChatCompletionOptions {
  options: ChatCompletionOptions;
  logger: (message: LogLine) => void;
  retries?: number;
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

/**
 * Resolve the language model for convenience wrappers.
 * Prefers the explicitly provided model, falls back to the client's
 * `getLanguageModel()`, and throws a helpful error if neither is available.
 */
function resolveModel(
  client: LLMClient,
  model?: LanguageModelV2,
): LanguageModelV2 {
  const resolved = model ?? client.getLanguageModel?.();
  if (!resolved) {
    throw new Error(
      "No language model available. This LLMClient does not implement getLanguageModel(). " +
        "Please pass a `model` parameter explicitly, or use a model name with '/' prefix " +
        '(e.g. "openai/gpt-4.1") so Stagehand can create an AI SDK-backed client.',
    );
  }
  return resolved;
}

export abstract class LLMClient {
  public type: "openai" | "anthropic" | "cerebras" | "groq" | (string & {});
  public modelName: AvailableModel | (string & {});
  public hasVision: boolean;
  public clientOptions: ClientOptions;
  public userProvidedInstructions?: string;

  constructor(modelName: AvailableModel, userProvidedInstructions?: string) {
    this.modelName = modelName;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  // Overload 1: When response_model is provided, returns LLMParsedResponse<T>
  abstract createChatCompletion<T>(
    options: CreateChatCompletionOptions & {
      options: {
        response_model: { name: string; schema: StagehandZodSchema };
      };
    },
  ): Promise<LLMParsedResponse<T>>;

  // Overload 2: When response_model is not provided, returns T (defaults to LLMResponse)
  abstract createChatCompletion<T = LLMResponse>(
    options: CreateChatCompletionOptions,
  ): Promise<T>;

  /**
   * Generate text using the Vercel AI SDK, with the client's model
   * automatically injected. You can still override by passing `model`.
   *
   * @example
   * ```ts
   * const { text } = await stagehand.llmClient.generateText({
   *   prompt: "Summarize the page content",
   * });
   * ```
   */
  public generateText(
    ...args: Parameters<typeof generateText>
  ): ReturnType<typeof generateText> {
    const [params] = args;
    return generateText({
      ...params,
      model: resolveModel(this, params.model),
    });
  }

  /**
   * Generate a structured object using the Vercel AI SDK, with the
   * client's model automatically injected. You can still override by
   * passing `model`.
   *
   * @example
   * ```ts
   * const { object } = await stagehand.llmClient.generateObject({
   *   schema: myZodSchema,
   *   prompt: "Extract the product details",
   * });
   * ```
   */
  public generateObject(
    ...args: Parameters<typeof generateObject>
  ): ReturnType<typeof generateObject> {
    const [params] = args;
    return generateObject({
      ...params,
      model: resolveModel(this, params.model),
    });
  }

  /**
   * Stream text using the Vercel AI SDK, with the client's model
   * automatically injected. You can still override by passing `model`.
   *
   * @example
   * ```ts
   * const { textStream } = await stagehand.llmClient.streamText({
   *   prompt: "Write a long story",
   * });
   * for await (const chunk of textStream) {
   *   process.stdout.write(chunk);
   * }
   * ```
   */
  public streamText(
    ...args: Parameters<typeof streamText>
  ): ReturnType<typeof streamText> {
    const [params] = args;
    return streamText({
      ...params,
      model: resolveModel(this, params.model),
    });
  }

  /**
   * Stream a structured object using the Vercel AI SDK, with the
   * client's model automatically injected. You can still override by
   * passing `model`.
   */
  public streamObject(
    ...args: Parameters<typeof streamObject>
  ): ReturnType<typeof streamObject> {
    const [params] = args;
    return streamObject({
      ...params,
      model: resolveModel(this, params.model),
    });
  }

  public generateImage = experimental_generateImage;
  public embed = embed;
  public embedMany = embedMany;
  public transcribe = experimental_transcribe;
  public generateSpeech = experimental_generateSpeech;

  getLanguageModel?(): LanguageModelV2;
}