import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ToolSet,
  ModelMessage,
  wrapLanguageModel,
  StreamTextResult,
  StepResult,
  PrepareStepFunction,
  GenerateTextOnStepFinishCallback,
  StreamTextOnStepFinishCallback,
  StreamTextOnErrorCallback,
  StreamTextOnChunkCallback,
  StreamTextOnFinishCallback,
  ToolCallRepairFunction,
} from "ai";
import { LogLine } from "./logs";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page } from "../../understudy/page";

export interface AgentContext {
  options: AgentExecuteOptions;
  maxSteps: number;
  systemPrompt: string;
  allTools: ToolSet;
  messages: ModelMessage[];
  wrappedModel: ReturnType<typeof wrapLanguageModel>;
  initialPageUrl: string;
}

export interface AgentState {
  collectedReasoning: string[];
  actions: AgentAction[];
  finalMessage: string;
  completed: boolean;
  currentPageUrl: string;
}

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
    reasoning_tokens?: number;
    cached_input_tokens?: number;
    inference_time_ms: number;
  };
}

export type AgentStreamResult = StreamTextResult<ToolSet, never> & {
  result: Promise<AgentResult>;
};


/**
 * Callbacks available for non-streaming execution.
 */
export interface AgentBaseCallbacks {
  /**
   * Optional function called before each step to modify settings.
   * You can change the model, tool choices, active tools, system prompt,
   * and input messages for each step.
   */
  prepareStep?: PrepareStepFunction<ToolSet>;
  /**
   * Callback called when each step (LLM call) is finished.
   * This is called for intermediate steps as well as the final step.
   */
  onStepFinish?: GenerateTextOnStepFinishCallback<ToolSet>;
}

/**
 * Additional callbacks only available for streaming execution.
 */
export interface AgentStreamCallbacks {
  /**
   * Optional function called before each step to modify settings.
   * You can change the model, tool choices, active tools, system prompt,
   * and input messages for each step.
   */
  prepareStep?: PrepareStepFunction<ToolSet>;
  /**
   * Callback called when each step (LLM call) is finished during streaming.
   */
  onStepFinish?: StreamTextOnStepFinishCallback<ToolSet>;
  /**
   * Callback called when an error occurs during streaming.
   */
  onError?: StreamTextOnErrorCallback;
  /**
   * Callback called for each chunk of the stream.
   * Stream processing will pause until the callback promise resolves.
   */
  onChunk?: StreamTextOnChunkCallback<ToolSet>;
  /**
   * Callback called when the stream finishes.
   */
  onFinish?: StreamTextOnFinishCallback<ToolSet>;
  /**
   * Callback called when the stream is aborted.
   */
  onAbort?: (event: {
    steps: Array<StepResult<ToolSet>>;
  }) => PromiseLike<void> | void;
}

/**
 * Combined callbacks type (for internal use).
 * @deprecated Use AgentBaseCallbacks or AgentStreamCallbacks instead
 */
export type AgentCallbacks = AgentBaseCallbacks | AgentStreamCallbacks;

/**
 * Stream-only callback keys for runtime validation.
 */
export const STREAM_ONLY_CALLBACKS = [
  "onChunk",
  "onError",
  "onFinish",
  "onAbort",
] as const;

/**
 * Base options shared by all execute configurations.
 */
interface AgentExecuteBaseOptions {
  instruction: string;
  maxSteps?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  highlightCursor?: boolean;
}

/**
 * Options for non-streaming agent execution.
 */
export interface AgentExecuteOptionsNonStreaming extends AgentExecuteBaseOptions {
  /**
   * Disable streaming mode (default).
   */
  stream?: false;
  /**
   * Callbacks for non-streaming execution.
   * Note: onChunk, onError, onFinish, onAbort are not available without streaming.
   */
  callbacks?: AgentBaseCallbacks;
}

/**
 * Options for streaming agent execution.
 */
export interface AgentExecuteOptionsStreaming extends AgentExecuteBaseOptions {
  /**
   * Enable streaming mode. Returns an AgentStreamResult
   * with textStream and fullStream iterables.
   */
  stream: true;
  /**
   * Callbacks for streaming execution.
   * Includes stream-specific callbacks: onChunk, onError, onFinish, onAbort.
   */
  callbacks?: AgentStreamCallbacks;
}

/**
 * Options for agent execution.
 * Use stream: true to enable streaming and access stream-specific callbacks.
 */
export type AgentExecuteOptions =
  | AgentExecuteOptionsNonStreaming
  | AgentExecuteOptionsStreaming;

/**
 * @deprecated Use AgentExecuteOptions with stream: true instead
 */
export type AgentStreamOptions = AgentExecuteOptions;
export type AgentType = "openai" | "anthropic" | "google";

export const AVAILABLE_CUA_MODELS = [
  "openai/computer-use-preview",
  "openai/computer-use-preview-2025-03-11",
  "anthropic/claude-3-7-sonnet-latest",
  "anthropic/claude-haiku-4-5-20251001",
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-sonnet-4-5-20250929",
  "google/gemini-2.5-computer-use-preview-10-2025",
] as const;
export type AvailableCuaModel = (typeof AVAILABLE_CUA_MODELS)[number];

export interface AgentExecutionOptions<
  TOptions extends AgentExecuteOptions = AgentExecuteOptions,
> {
  options: TOptions;
  logger: (message: LogLine) => void;
  retries?: number;
}

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

/**
 * Agent instance with execute method that supports both streaming and non-streaming modes.
 */
export interface AgentInstance {
  /**
   * Execute an agent task.
   * @param instructionOrOptions - The instruction string or options object
   * @returns Promise<AgentResult> when stream is false/undefined, Promise<AgentStreamResult> when stream is true
   */
  execute: {
    (
      instructionOrOptions:
        | string
        | (AgentExecuteOptions & { stream?: false | undefined }),
    ): Promise<AgentResult>;
    (
      instructionOrOptions: AgentExecuteOptions & { stream: true },
    ): Promise<AgentStreamResult>;
    (instructionOrOptions: string | AgentExecuteOptions): Promise<
      AgentResult | AgentStreamResult
    >;
  };
}

export type AgentProviderType = AgentType;

export type AgentModelConfig<TModelName extends string = string> = {
  modelName: TModelName;
} & Record<string, unknown>;

export type AgentConfig = {
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
  /**
   * Indicates CUA is disabled for this configuration
   */
  cua?: boolean;
  /**
   * The model to use for agent functionality
   */
  model?: string | AgentModelConfig<string>;
  /**
   * The model to use for tool execution (observe/act calls within agent tools).
   * If not specified, inherits from the main model configuration.
   * Format: "provider/model" (e.g., "openai/gpt-4o-mini", "google/gemini-2.0-flash-exp")
   */
  executionModel?: string | AgentModelConfig<string>;
};
