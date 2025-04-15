import { ZodType } from "zod";
import { LLMTool } from "../../types/llm";
import { LogLine } from "../../types/log";
import { AvailableModel, ClientOptions } from "../../types/model";

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
    schema: ZodType;
  };
  tools?: LLMTool[];
  tool_choice?: "auto" | "none" | "required";
  maxTokens?: number;
  requestId: string;
}

// Base response type for common fields
export interface BaseResponse {
  id: string;
  object: string;
  created: number;
  model: string;
}

// Tool call type
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

// Message type
export interface LLMMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
}

// Choice type
export interface LLMChoice {
  index: number;
  message: LLMMessage;
  finish_reason: string;
}

// Usage metrics
export interface UsageMetrics {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Main LLM Response type
export interface LLMResponse extends BaseResponse {
  choices: LLMChoice[];
  usage: UsageMetrics;
}

// Main LLM Response type
export interface LLMObjectResponse extends BaseResponse {
  data: Record<string, unknown>;
  usage: UsageMetrics;
}

// Text Response type that can include LLM properties
export interface TextResponse extends BaseResponse {
  text: string;
  choices?: LLMChoice[];
  usage?: UsageMetrics;
}

// Object Response type that can include LLM properties
export interface ObjectResponse extends BaseResponse {
  object: string;
  choices?: LLMChoice[];
  usage?: UsageMetrics;
}

export interface CreateChatCompletionOptions {
  options: ChatCompletionOptions;
  logger: (message: LogLine) => void;
  retries?: number;
}

export interface GenerateTextOptions {
  prompt: string;
  options?: Partial<Omit<ChatCompletionOptions, "messages">> & {
    logger?: (message: LogLine) => void;
    retries?: number;
  };
}

export interface GenerateObjectOptions {
  prompt: string;
  schema: ZodType;
  options?: Partial<Omit<ChatCompletionOptions, "messages">> & {
    logger?: (message: LogLine) => void;
    retries?: number;
  };
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

  abstract createChatCompletion<
    T = LLMResponse & {
      usage?: LLMResponse["usage"];
    },
  >(options: CreateChatCompletionOptions): Promise<T>;

  abstract generateText<
    T = TextResponse & {
      usage?: TextResponse["usage"];
    },
  >(input: GenerateTextOptions): Promise<T>;

  abstract generateObject<
    T = ObjectResponse & {
      usage?: ObjectResponse["usage"];
    },
  >(input: GenerateObjectOptions): Promise<T>;
}
