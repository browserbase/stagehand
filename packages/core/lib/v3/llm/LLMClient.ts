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

type OptionalModelOptions<TOptions> = TOptions extends { model: infer TModel }
  ? Omit<TOptions, "model"> & { model?: TModel }
  : TOptions;

type GenerateTextOptions = OptionalModelOptions<
  Parameters<typeof generateText>[0]
>;
type GenerateObjectOptions = OptionalModelOptions<
  Parameters<typeof generateObject>[0]
>;
type StreamTextOptions = OptionalModelOptions<Parameters<typeof streamText>[0]>;
type StreamObjectOptions = OptionalModelOptions<
  Parameters<typeof streamObject>[0]
>;

function resolveLanguageModel<TModel>(
  client: LLMClient,
  model: TModel | undefined,
): TModel {
  const resolvedModel = model ?? client.getLanguageModel?.();

  if (!resolvedModel) {
    throw new Error(
      "No language model available. Pass a `model` option explicitly or use an LLMClient that implements getLanguageModel().",
    );
  }

  return resolvedModel as TModel;
}

function withResolvedLanguageModel<TOptions extends object>(
  client: LLMClient,
  options: TOptions,
): TOptions {
  const model = "model" in options ? options.model : undefined;

  return {
    ...options,
    model: resolveLanguageModel(client, model),
  } as TOptions;
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

  public generateObject(
    options: GenerateObjectOptions,
  ): ReturnType<typeof generateObject> {
    return generateObject(
      withResolvedLanguageModel(this, options) as Parameters<
        typeof generateObject
      >[0],
    );
  }

  public generateText(
    options: GenerateTextOptions,
  ): ReturnType<typeof generateText> {
    return generateText(
      withResolvedLanguageModel(this, options) as Parameters<
        typeof generateText
      >[0],
    );
  }

  public streamText(options: StreamTextOptions): ReturnType<typeof streamText> {
    return streamText(
      withResolvedLanguageModel(this, options) as Parameters<
        typeof streamText
      >[0],
    );
  }

  public streamObject(
    options: StreamObjectOptions,
  ): ReturnType<typeof streamObject> {
    return streamObject(
      withResolvedLanguageModel(this, options) as Parameters<
        typeof streamObject
      >[0],
    );
  }
  public generateImage = experimental_generateImage;
  public embed = embed;
  public embedMany = embedMany;
  public transcribe = experimental_transcribe;
  public generateSpeech = experimental_generateSpeech;

  getLanguageModel?(): LanguageModelV2;
}
