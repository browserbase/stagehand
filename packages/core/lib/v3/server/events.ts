/**
 * Base event interface - all events extend this
 */
export interface StagehandServerEvent {
  timestamp: Date;
  sessionId?: string;
  requestId?: string;
}

// ===== LLM REQUEST/RESPONSE EVENTS =====
// These are the only events with actual subscribers (used by llmEventBridge.ts and llmEventHandler.ts)

export interface StagehandLLMRequestEvent extends StagehandServerEvent {
  type: "StagehandLLMRequest";
  requestId: string;

  // Model config
  modelName: string;
  temperature?: number;
  maxTokens?: number;

  // Request data
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string | Array<{ type: string; text?: string; image?: string }>;
  }>;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  schema?: Record<string, unknown>; // JSON schema for structured output

  // Context
  requestType?: "act" | "extract" | "observe" | "agent" | "cua";
}

export interface StagehandLLMResponseEvent extends StagehandServerEvent {
  type: "StagehandLLMResponse";
  requestId: string; // Must match StagehandLLMRequestEvent.requestId

  // Response data
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  finishReason: string;

  // Metrics
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  // Raw and parsed responses (for internal use)
  rawResponse?: unknown;
  parsedResponse?: unknown;

  // Error handling
  error?: {
    message: string;
    code?: string;
  };
}

export interface StagehandLLMErrorEvent extends StagehandServerEvent {
  type: "StagehandLLMError";
  requestId: string;
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
}

// Union type for all events
export type StagehandServerEventType =
  | StagehandLLMRequestEvent
  | StagehandLLMResponseEvent
  | StagehandLLMErrorEvent;

// Type-safe event emitter interface
export interface StagehandServerEventMap {
  StagehandLLMRequest: StagehandLLMRequestEvent;
  StagehandLLMResponse: StagehandLLMResponseEvent;
  StagehandLLMError: StagehandLLMErrorEvent;
}
