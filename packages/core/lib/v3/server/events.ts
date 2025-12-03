import type { V3Options, LogLine } from "../types/public";
import type { FastifyRequest } from "fastify";

/**
 * Base event interface - all events extend this
 */
export interface StagehandServerEvent {
  timestamp: Date;
  sessionId?: string;
  requestId?: string; // For correlation across events
}

// ===== SERVER LIFECYCLE EVENTS =====

export interface StagehandServerStartedEvent extends StagehandServerEvent {
  type: "StagehandServerStarted";
  port: number;
  host: string;
}

export interface StagehandServerReadyEvent extends StagehandServerEvent {
  type: "StagehandServerReady";
}

export interface StagehandServerShutdownEvent extends StagehandServerEvent {
  type: "StagehandServerShutdown";
  graceful: boolean;
}

// ===== SESSION LIFECYCLE EVENTS =====

export interface StagehandSessionResumedEvent extends StagehandServerEvent {
  type: "StagehandSessionResumed";
  sessionId: string;
  fromCache: boolean;
}

export interface StagehandSessionInitializedEvent extends StagehandServerEvent {
  type: "StagehandSessionInitialized";
  sessionId: string;
}

export interface StagehandSessionEndedEvent extends StagehandServerEvent {
  type: "StagehandSessionEnded";
  sessionId: string;
  reason: "manual" | "ttl_expired" | "cache_evicted" | "error";
}

// ===== REQUEST LIFECYCLE EVENTS =====

export interface StagehandRequestReceivedEvent extends StagehandServerEvent {
  type: "StagehandRequestReceived";
  sessionId: string;
  requestId: string;
  method: string;
  path: string;
  headers: {
    "x-stream-response"?: boolean;
    "x-bb-api-key"?: string;
    "x-model-api-key"?: string;
    "x-sdk-version"?: string;
    "x-language"?: string;
    "x-sent-at"?: string;
  };
  bodySize: number;
}

export interface StagehandRequestValidatedEvent extends StagehandServerEvent {
  type: "StagehandRequestValidated";
  sessionId: string;
  requestId: string;
  schemaVersion: "v3";
  parsedData: unknown;
}

export interface StagehandRequestCompletedEvent extends StagehandServerEvent {
  type: "StagehandRequestCompleted";
  sessionId: string;
  requestId: string;
  statusCode: number;
  responseSize?: number;
  durationMs: number;
}

// ===== ACTION LIFECYCLE EVENTS =====

export interface StagehandActionStartedEvent extends StagehandServerEvent {
  type: "StagehandActionStarted";
  sessionId: string;
  requestId: string;
  actionId?: string; // Will be set by cloud listeners
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  input: string | object;
  options: object;
  url: string;
  frameId?: string;
}

export interface StagehandActionProgressEvent extends StagehandServerEvent {
  type: "StagehandActionProgress";
  sessionId: string;
  requestId: string;
  actionId?: string;
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  message: LogLine;
}

export interface StagehandActionCompletedEvent extends StagehandServerEvent {
  type: "StagehandActionCompleted";
  sessionId: string;
  requestId: string;
  actionId?: string;
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  result: unknown;
  metrics?: {
    promptTokens: number;
    completionTokens: number;
    inferenceTimeMs: number;
  };
  durationMs: number;
}

export interface StagehandActionErroredEvent extends StagehandServerEvent {
  type: "StagehandActionErrored";
  sessionId: string;
  requestId: string;
  actionId?: string;
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  durationMs: number;
}

// ===== STREAMING EVENTS =====

export interface StagehandStreamStartedEvent extends StagehandServerEvent {
  type: "StagehandStreamStarted";
  sessionId: string;
  requestId: string;
}

export interface StagehandStreamMessageSentEvent extends StagehandServerEvent {
  type: "StagehandStreamMessageSent";
  sessionId: string;
  requestId: string;
  messageType: "system" | "log";
  data: unknown;
}

export interface StagehandStreamEndedEvent extends StagehandServerEvent {
  type: "StagehandStreamEnded";
  sessionId: string;
  requestId: string;
}

// ===== CACHE EVENTS =====

export interface StagehandCacheHitEvent extends StagehandServerEvent {
  type: "StagehandCacheHit";
  sessionId: string;
  cacheKey: string;
}

export interface StagehandCacheMissedEvent extends StagehandServerEvent {
  type: "StagehandCacheMissed";
  sessionId: string;
  cacheKey: string;
}

export interface StagehandCacheEvictedEvent extends StagehandServerEvent {
  type: "StagehandCacheEvicted";
  sessionId: string;
  cacheKey: string;
  reason: "lru" | "ttl" | "manual";
}

// ===== LLM REQUEST/RESPONSE EVENTS =====

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
  | StagehandServerStartedEvent
  | StagehandServerReadyEvent
  | StagehandServerShutdownEvent
  | StagehandSessionResumedEvent
  | StagehandSessionInitializedEvent
  | StagehandSessionEndedEvent
  | StagehandRequestReceivedEvent
  | StagehandRequestValidatedEvent
  | StagehandRequestCompletedEvent
  | StagehandActionStartedEvent
  | StagehandActionProgressEvent
  | StagehandActionCompletedEvent
  | StagehandActionErroredEvent
  | StagehandStreamStartedEvent
  | StagehandStreamMessageSentEvent
  | StagehandStreamEndedEvent
  | StagehandCacheHitEvent
  | StagehandCacheMissedEvent
  | StagehandCacheEvictedEvent
  | StagehandLLMRequestEvent
  | StagehandLLMResponseEvent
  | StagehandLLMErrorEvent;

// Type-safe event emitter interface
export interface StagehandServerEventMap {
  StagehandServerStarted: StagehandServerStartedEvent;
  StagehandServerReady: StagehandServerReadyEvent;
  StagehandServerShutdown: StagehandServerShutdownEvent;
  StagehandSessionResumed: StagehandSessionResumedEvent;
  StagehandSessionInitialized: StagehandSessionInitializedEvent;
  StagehandSessionEnded: StagehandSessionEndedEvent;
  StagehandRequestReceived: StagehandRequestReceivedEvent;
  StagehandRequestValidated: StagehandRequestValidatedEvent;
  StagehandRequestCompleted: StagehandRequestCompletedEvent;
  StagehandActionStarted: StagehandActionStartedEvent;
  StagehandActionProgress: StagehandActionProgressEvent;
  StagehandActionCompleted: StagehandActionCompletedEvent;
  StagehandActionErrored: StagehandActionErroredEvent;
  StagehandStreamStarted: StagehandStreamStartedEvent;
  StagehandStreamMessageSent: StagehandStreamMessageSentEvent;
  StagehandStreamEnded: StagehandStreamEndedEvent;
  StagehandCacheHit: StagehandCacheHitEvent;
  StagehandCacheMissed: StagehandCacheMissedEvent;
  StagehandCacheEvicted: StagehandCacheEvictedEvent;
  StagehandLLMRequest: StagehandLLMRequestEvent;
  StagehandLLMResponse: StagehandLLMResponseEvent;
  StagehandLLMError: StagehandLLMErrorEvent;
}
