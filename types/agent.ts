import { LogLine } from "./log";
import { ObserveResult } from "./stagehand";

export interface ActToolResult {
  success: boolean;
  action?: string;
  error?: string;
  isIframe?: boolean;
  playwrightArguments?: ObserveResult | null;
}

export interface AgentAction {
  type: string;
  reasoning?: string;
  taskCompleted?: boolean;
  action?: string;
  // Tool-specific fields
  timeMs?: number; // wait tool
  pageText?: string; // ariaTree tool
  timestamp?: number;
  pageUrl?: string; // ariaTree tool
  instruction?: string; // various tools
  playwrightArguments?: ObserveResult | null; // act tool
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

export interface AgentOptions {
  maxSteps?: number;
  autoScreenshot?: boolean;
  waitBetweenActions?: number;
  context?: string;
  highlightCursor?: boolean;
}

export interface AgentExecuteOptions extends AgentOptions {
  instruction: string;
}

export type AgentProviderType = "openai" | "anthropic" | "google";

export interface AgentClientOptions {
  apiKey: string;
  organization?: string;
  baseURL?: string;
  defaultMaxSteps?: number;
  [key: string]: unknown;
}

export type AgentType = "openai" | "anthropic" | "google";

export interface AgentExecutionOptions {
  options: AgentExecuteOptions;
  logger: (message: LogLine) => void;
  retries?: number;
}

export interface AgentHandlerOptions {
  modelName: string;
  clientOptions?: Record<string, unknown>;
  userProvidedInstructions?: string;
  agentType: AgentType;
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
  setScreenshotCollector?: (collector: unknown) => void;
}
