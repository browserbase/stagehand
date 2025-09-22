import type {
  StreamTextOnStepFinishCallback,
  StreamTextOnFinishCallback,
  StreamTextOnErrorCallback,
  StreamTextOnChunkCallback,
  ToolSet,
} from "ai";
import type { AgentTools } from "@/lib/agent/tools";
import type { LogLine } from "./log";

/**
 * Agent hook event types that can be streamed from the server
 */
export type AgentHookEventType =
  | "step_start"
  | "step_finish"
  | "chunk"
  | "error"
  | "finish";

/**
 * Base structure for all agent hook events
 */
export interface BaseAgentHookEvent {
  type: AgentHookEventType;
  timestamp: string;
  sessionId: string;
  executionId: string;
}

/**
 * Event fired when an agent step begins
 */
export interface StepStartEvent extends BaseAgentHookEvent {
  type: "step_start";
  data: {
    stepIndex: number;
    instruction: string;
    reasoning?: string;
  };
}

/**
 * Valid agent tool names
 */
export type AgentToolName =
  | "act"
  | "ariaTree"
  | "close"
  | "extract"
  | "fillForm"
  | "goto"
  | "navback"
  | "screenshot"
  | "scroll"
  | "wait";

/**
 * Tool invocation state
 */
export type ToolInvocationState = "call" | "result" | "error";

/**
 * Tool invocation from server event
 */
export interface ServerToolInvocation {
  toolCallId: string;
  toolName: AgentToolName;
  args: Record<string, unknown>;
  result: unknown;
  state: ToolInvocationState;
  error?: string;
}

/**
 * Event fired when an agent step completes
 */
export interface StepFinishEvent extends BaseAgentHookEvent {
  type: "step_finish";
  data: {
    stepIndex: number;
    result: {
      text: string;
      toolInvocations: ServerToolInvocation[];
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      finishReason: string;
    };
    isLastStep: boolean;
  };
}

/**
 * Chunk types for streaming events
 */
export type ChunkType = "text-delta" | "tool-call-delta" | "tool-result-delta";

/**
 * Text delta chunk
 */
export interface TextDeltaChunk {
  type: "text-delta";
  textDelta: string;
}

/**
 * Tool call delta chunk
 */
export interface ToolCallDeltaChunk {
  type: "tool-call-delta";
  toolCallId: string;
  toolName: AgentToolName;
  argsTextDelta: string;
}

/**
 * Tool result delta chunk
 */
export interface ToolResultDeltaChunk {
  type: "tool-result-delta";
  toolCallId: string;
  toolName: AgentToolName;
  toolResult: unknown;
}

/**
 * Union of all chunk types
 */
export type ChunkData =
  | TextDeltaChunk
  | ToolCallDeltaChunk
  | ToolResultDeltaChunk;

/**
 * Event fired for streaming text chunks
 */
export interface ChunkEvent extends BaseAgentHookEvent {
  type: "chunk";
  data: {
    stepIndex: number;
    chunk: ChunkData;
  };
}

/**
 * Event fired when an error occurs during execution
 */
export interface ErrorEvent extends BaseAgentHookEvent {
  type: "error";
  data: {
    stepIndex?: number;
    error: {
      name: string;
      message: string;
      stack?: string;
      code?: string;
    };
    isRecoverable: boolean;
  };
}

/**
 * Event fired when agent execution completes
 */
export interface FinishEvent extends BaseAgentHookEvent {
  type: "finish";
  data: {
    totalSteps: number;
    finalResult: {
      success: boolean;
      message: string;
      actions: Array<{
        type: string;
        reasoning?: string;
        action?: string;
        success?: boolean;
        error?: string;
        [key: string]: unknown;
      }>;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    };
    executionTimeMs: number;
  };
}

/**
 * Union of all possible agent hook events
 */
export type AgentHookEvent =
  | StepStartEvent
  | StepFinishEvent
  | ChunkEvent
  | ErrorEvent
  | FinishEvent;

/**
 * Type for streaming response events from the API
 */
export interface AgentStreamEvent {
  type: "hook_event" | "log" | "system";
  data:
    | AgentHookEvent
    | LogLine
    | { status: string; result?: unknown; error?: string };
}

/**
 * Interface for client-side agent hook handlers
 */
export interface AgentHookHandlers {
  onStepFinish?: StreamTextOnStepFinishCallback<AgentTools & ToolSet>;
  onFinish?: StreamTextOnFinishCallback<AgentTools & ToolSet>;
  onError?: StreamTextOnErrorCallback;
  onChunk?: StreamTextOnChunkCallback<AgentTools & ToolSet>;
}

/**
 * Configuration for agent hook execution in API mode
 */
export interface AgentHookConfig {
  enableHooks: boolean;
  handlers: AgentHookHandlers;
  executionId: string;
}

/**
 * Mapping between hook events and their corresponding handler types
 */
export interface HookEventMapping {
  step_finish: StreamTextOnStepFinishCallback<AgentTools & ToolSet>;
  finish: StreamTextOnFinishCallback<AgentTools & ToolSet>;
  error: StreamTextOnErrorCallback;
  chunk: StreamTextOnChunkCallback<AgentTools & ToolSet>;
}

/**
 * Adapter interface for converting server events to AI SDK format
 */
export interface AgentHookEventAdapter {
  adaptStepFinishEvent(
    event: StepFinishEvent,
  ): Parameters<StreamTextOnStepFinishCallback<AgentTools & ToolSet>>[0];
  adaptFinishEvent(
    event: FinishEvent,
  ): Parameters<StreamTextOnFinishCallback<AgentTools & ToolSet>>[0];
  adaptErrorEvent(event: ErrorEvent): Parameters<StreamTextOnErrorCallback>[0];
  adaptChunkEvent(
    event: ChunkEvent,
  ): Parameters<StreamTextOnChunkCallback<AgentTools & ToolSet>>[0];
}
