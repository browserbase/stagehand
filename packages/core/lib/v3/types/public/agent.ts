import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolSet } from "ai";
import { LogLine } from "./logs";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page } from "../../understudy/page";

export interface AgentAction {
  type: string;
  reasoning?: string;
  taskCompleted?: boolean;
  action?: string;
  // Tool-specific fields
  timeMs?: number; // wait tool
  pageText?: string; // ariaTree tool
  pageUrl?: string; // ariaTree tool
  instruction?: string; // various tools
  [key: string]: unknown;
}

export interface AgentResult {
  success: boolean;
  message: string;
  actions: AgentAction[];
  completed: boolean;
  metadata?: Record<string, unknown>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    inference_time_ms: number;
  };
}

export interface BaseAgentExecuteOptions {
  instruction: string;
  maxSteps?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
}

export interface AgentExecuteOptions extends BaseAgentExecuteOptions {
  highlightCursor?: never;
}

export interface CuaAgentExecuteOptions extends BaseAgentExecuteOptions {
  highlightCursor?: boolean;
}

export type AnyAgentExecuteOptions =
  | AgentExecuteOptions
  | CuaAgentExecuteOptions;

export type AgentType = "openai" | "anthropic" | "google";

export type AvailableCuaModel =
  | "openai/computer-use-preview"
  | "openai/computer-use-preview-2025-03-11"
  | "anthropic/claude-3-7-sonnet-latest"
  | "anthropic/claude-sonnet-4-20250514"
  | "anthropic/claude-sonnet-4-5-20250929"
  | "google/gemini-2.5-computer-use-preview-10-2025";

export interface AgentExecutionOptions<
  TOptions extends BaseAgentExecuteOptions = AgentExecuteOptions,
> {
  options: TOptions;
  logger: (message: LogLine) => void;
  retries?: number;
}

export type CuaAgentExecutionOptions =
  AgentExecutionOptions<CuaAgentExecuteOptions>;

export interface AgentHandlerOptions {
  modelName: string;
  clientOptions?: Record<string, unknown>;
  userProvidedInstructions?: string;
  experimental?: boolean;
}

export interface ActionExecutionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

// Anthropic types:

export interface ToolUseItem extends ResponseItem {
  type: "tool_use";
  id: string; // This is the correct property name from Anthropic's API
  name: string; // Name of the tool being used
  input: Record<string, unknown>;
}

export interface AnthropicMessage {
  role: string;
  content: string | Array<AnthropicContentBlock>;
}

export interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface AnthropicTextBlock extends AnthropicContentBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<AnthropicContentBlock>;
}

// OpenAI types:

export interface ResponseItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface ComputerCallItem extends ResponseItem {
  type: "computer_call";
  call_id: string;
  action: {
    type: string;
    [key: string]: unknown;
  };
  pending_safety_checks?: Array<{
    id: string;
    code: string;
    message: string;
  }>;
}

export interface FunctionCallItem extends ResponseItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export type ResponseInputItem =
  | { role: string; content: string }
  | {
      type: "computer_call_output";
      call_id: string;
      output:
        | {
            type: "input_image";
            image_url: string;
            current_url?: string;
            error?: string;
            [key: string]: unknown;
          }
        | string;
      acknowledged_safety_checks?: Array<{
        id: string;
        code: string;
        message: string;
      }>;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export interface AgentInstance {
  execute: (
    instructionOrOptions: string | AgentExecuteOptions,
  ) => Promise<AgentResult>;
}

export type AgentProviderType = AgentType;

export type AgentModelConfig<TModelName extends string = string> = {
  modelName: TModelName;
} & Record<string, unknown>;

type SharedAgentConfigFields = {
  /**
   * Custom system prompt to provide to the agent. Overrides the default system prompt.
   */
  systemPrompt?: string;
  /**
   * MCP integrations - Array of Client objects
   */
  integrations?: (Client | string)[];
  /**
   * Tools passed to the agent client
   */
  tools?: ToolSet;
};

type StandardAgentConfig = SharedAgentConfigFields & {
  /**
   * Indicates CUA is disabled for this configuration
   */
  cua?: false;
  /**
   * The model to use for agent functionality
   */
  model?: string | AgentModelConfig<string>;
  /**
   * The model to use for tool execution (observe/act calls within agent tools).
   * If not specified, inherits from the main model configuration.
   * Format: "provider/model" (e.g., "openai/gpt-4o-mini", "google/gemini-2.0-flash-exp")
   */
  executionModel?: string;
};

type CuaAgentConfig = SharedAgentConfigFields & {
  /**
   * Indicates CUA is enabled for this configuration
   */
  cua: true;
  /**
   * The model to use for agent functionality when CUA is enabled
   */
  model: AvailableCuaModel | AgentModelConfig<AvailableCuaModel>;
  /**
   * Execution models are not supported when CUA is enabled
   */
  executionModel?: never;
};

/**
 * Configuration for agent functionality
 */
export type AgentConfig = StandardAgentConfig | CuaAgentConfig;
