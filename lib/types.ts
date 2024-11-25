import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { ChatCompletionTool as OpenAITool } from "openai/resources";

export class PlaywrightCommandException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightCommandException";
  }
}

export class PlaywrightCommandMethodNotSupportedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightCommandMethodNotSupportedException";
  }
}

export type LogLine = {
  id?: string;
  category?: string;
  message: string;
  level?: 0 | 1 | 2;
  timestamp?: string;
  auxiliary?: {
    [key: string]: {
      value: string;
      type: "object" | "string" | "html" | "integer" | "float" | "boolean";
    };
  };
};

export type AvailableModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4o-2024-08-06"
  | "claude-3-5-sonnet-latest"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-sonnet-20240620";

export type ModelProvider = "openai" | "anthropic";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export type ToolCall = AnthropicTool | OpenAITool;
