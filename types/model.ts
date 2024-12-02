import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { ChatCompletionTool as OpenAITool } from "openai/resources";
import {  RequestOptions as GoogleClientOptions, Tool as GoogleTool } from "@google/generative-ai";

export type AvailableModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4o-2024-08-06"
  | "claude-3-5-sonnet-latest"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-sonnet-20240620"
  | "gemini-pro"
  ;

export type ModelProvider = "openai" | "anthropic" | "google";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions | GoogleClientOptions;

export type ToolCall = AnthropicTool | OpenAITool | GoogleTool;
