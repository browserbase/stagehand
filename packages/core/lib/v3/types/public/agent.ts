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
} from "ai";
import { LogLine } from "./logs";
import { ClientOptions } from "./model";

// Re-export ModelMessage for consumers who want to use it for conversation continuation
export type { ModelMessage } from "ai";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page } from "../../understudy/page";

export interface AgentContext {
  options: AgentExecuteOptionsBase;
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
  /**
   * The conversation messages from this execution.
   * Pass these to a subsequent execute() call via the `messages` option to continue the conversation.
   * @experimental
   */
  messages?: ModelMessage[];
}

export type AgentStreamResult = StreamTextResult<ToolSet, never> & {
  result: Promise<AgentResult>;
};

/**
 * Base callbacks shared between execute (non-streaming) and streaming modes.
 */
export interface AgentCallbacks {
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
  onStepFinish?:
    | GenerateTextOnStepFinishCallback<ToolSet>
    | StreamTextOnStepFinishCallback<ToolSet>;
}

/**
 * Error message type for streaming-only callbacks used in non-streaming mode.
 * This provides a clear error message when users try to use streaming callbacks without stream: true.
 */
type StreamingCallbackNotAvailable =
  "This callback requires 'stream: true' in AgentConfig. Set stream: true to use streaming callbacks like onChunk, onFinish, onError, and onAbort.";

/**
 * Callbacks specific to the non-streaming execute method.
 */
export interface AgentExecuteCallbacks extends AgentCallbacks {
  /**
   * Callback called when each step (LLM call) is finished.
   */
  onStepFinish?: GenerateTextOnStepFinishCallback<ToolSet>;

  /**
   * NOT AVAILABLE in non-streaming mode.
   * This callback requires `stream: true` in AgentConfig.
   *
   * @example
   * ```typescript
   * // Enable streaming to use onChunk:
   * const agent = stagehand.agent({ stream: true });
   * await agent.execute({
   *   instruction: "...",
   *   callbacks: { onChunk: async (chunk) => console.log(chunk) }
   * });
   * ```
   */
  onChunk?: StreamingCallbackNotAvailable;

  /**
   * NOT AVAILABLE in non-streaming mode.
   * This callback requires `stream: true` in AgentConfig.
   *
   * @example
   * ```typescript
   * // Enable streaming to use onFinish:
   * const agent = stagehand.agent({ stream: true });
   * await agent.execute({
   *   instruction: "...",
   *   callbacks: { onFinish: (event) => console.log("Done!", event) }
   * });
   * ```
   */
  onFinish?: StreamingCallbackNotAvailable;

  /**
   * NOT AVAILABLE in non-streaming mode.
   * This callback requires `stream: true` in AgentConfig.
   *
   * @example
   * ```typescript
   * // Enable streaming to use onError:
   * const agent = stagehand.agent({ stream: true });
   * await agent.execute({
   *   instruction: "...",
   *   callbacks: { onError: ({ error }) => console.error(error) }
   * });
   * ```
   */
  onError?: StreamingCallbackNotAvailable;

  /**
   * NOT AVAILABLE in non-streaming mode.
   * This callback requires `stream: true` in AgentConfig.
   *
   * @example
   * ```typescript
   * // Enable streaming to use onAbort:
   * const agent = stagehand.agent({ stream: true });
   * await agent.execute({
   *   instruction: "...",
   *   callbacks: { onAbort: (event) => console.log("Aborted", event.steps) }
   * });
   * ```
   */
  onAbort?: StreamingCallbackNotAvailable;
}

/**
 * Callbacks specific to the streaming mode.
 */
export interface AgentStreamCallbacks extends AgentCallbacks {
  /**
   * Callback called when each step (LLM call) is finished during streaming.
   */
  onStepFinish?: StreamTextOnStepFinishCallback<ToolSet>;
  /**
   * Callback called when an error occurs during streaming.
   * Use this to log errors or handle error states.
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
 * Base options for agent execution (without callbacks).
 */
export interface AgentExecuteOptionsBase {
  instruction: string;
  maxSteps?: number;
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  highlightCursor?: boolean;
  /**
   * Previous conversation messages to continue from.
   * Pass the `messages` from a previous AgentResult to continue that conversation.
   * @experimental
   */
  messages?: ModelMessage[];
  /**
   * An AbortSignal that can be used to cancel the agent execution.
   * When aborted, the agent will stop and return a partial result.
   * @experimental
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 30000); // 30 second timeout
   *
   * const result = await agent.execute({
   *   instruction: "...",
   *   signal: controller.signal
   * });
   * ```
   */
  signal?: AbortSignal;
}

/**
 * Options for non-streaming agent execution.
 * Only accepts AgentExecuteCallbacks (no streaming-specific callbacks like onChunk, onFinish).
 */
export interface AgentExecuteOptions extends AgentExecuteOptionsBase {
  /**
   * Callbacks for non-streaming agent execution.
   * For streaming callbacks (onChunk, onFinish, onError, onAbort), use stream: true in AgentConfig.
   */
  callbacks?: AgentExecuteCallbacks;
}

/**
 * Options for streaming agent execution.
 * Accepts AgentStreamCallbacks including onChunk, onFinish, onError, and onAbort.
 */
export interface AgentStreamExecuteOptions extends AgentExecuteOptionsBase {
  /**
   * Callbacks for streaming agent execution.
   * Includes streaming-specific callbacks: onChunk, onFinish, onError, onAbort.
   */
  callbacks?: AgentStreamCallbacks;
}
export type AgentType =
  | "openai"
  | "anthropic"
  | "google"
  | "microsoft"
  | "openagi";

export const AVAILABLE_CUA_MODELS = [
  "openai/computer-use-preview",
  "openai/computer-use-preview-2025-03-11",
  "anthropic/claude-3-7-sonnet-latest",
  "anthropic/claude-opus-4-5-20251101",
  "anthropic/claude-haiku-4-5-20251001",
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-sonnet-4-5-20250929",
  "google/gemini-2.5-computer-use-preview-10-2025",
  "microsoft/fara-7b",
  "openagi/lux-actor-1",
  "openagi/lux-thinker-1",
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
  clientOptions?: ClientOptions;
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

/**
 * Agent tool mode determines which set of tools are available to the agent.
 * - 'dom': Uses DOM-based tools (act, fillForm) - better for structured page interactions
 * - 'hybrid': Uses coordinate-based tools (click, type, dragAndDrop, etc.) - better for visual/screenshot-based interactions
 * - 'cua': Uses Computer Use Agent (CUA) providers like Anthropic Claude or Google Gemini for screenshot-based automation
 */
export type AgentToolMode = "dom" | "hybrid" | "cua";

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
   * @deprecated Use `mode: "cua"` instead. This option will be removed in a future version.
   * Enables Computer Use Agent (CUA) mode.
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
  /**
   * Enable streaming mode for the agent.
   * When true, execute() returns AgentStreamResult with textStream for incremental output.
   * When false (default), execute() returns AgentResult after completion.
   */
  stream?: boolean;
  /**
   * Tool mode for the agent. Determines which set of tools are available.
   * - 'dom' (default): Uses DOM-based tools (act, fillForm) for structured interactions
   * - 'hybrid': Uses coordinate-based tools (click, type, dragAndDrop, clickAndHold, fillFormVision)
   *             for visual/screenshot-based interactions
   * - 'cua': Uses Computer Use Agent (CUA) providers for screenshot-based automation
   */
  mode?: AgentToolMode;
};

/**
 * Agent instance returned when stream: true is set in AgentConfig.
 * execute() returns a streaming result that can be consumed incrementally.
 * Accepts AgentStreamExecuteOptions with streaming-specific callbacks.
 */
export interface StreamingAgentInstance {
  execute: (
    instructionOrOptions: string | AgentStreamExecuteOptions,
  ) => Promise<AgentStreamResult>;
}

/**
 * Agent instance returned when stream is false or not set in AgentConfig.
 * execute() returns a result after the agent completes.
 * Accepts AgentExecuteOptions with non-streaming callbacks only.
 */
export interface NonStreamingAgentInstance {
  execute: (
    instructionOrOptions: string | AgentExecuteOptions,
  ) => Promise<AgentResult>;
}
